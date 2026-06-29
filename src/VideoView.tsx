/**
 * VideoView — the Video-clip composer (ADR-0010). Pick a saved song as the soundtrack, import
 * images, order them with per-image durations (auto "fit to song" even-split), and preview the
 * selected frame. Stage 1: compose + CRUD + persistence (playback preview, save/open, and MP4
 * export come next). State lives in useVideo; the song list is read from the songs library.
 */

import { useCallback, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useVideo } from "./useVideo";
import { loadSongs, addSongToLibrary } from "./songsStore";
import { renderMixedSong, songDurationMs } from "./exportSong";
import { recordVideo, pickVideoMime } from "./videoExport";
import { imagesTotalMs } from "./videoStore";
import {
  buildVideoBundle,
  serializeVideoBundle,
  parseVideoBundle,
  importVideoBundle,
  VIDEO_EXT,
} from "./videoProject";
import { formatDuration, type Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onAddRecordings: (recs: Recording[]) => void;
  onGoToSong: () => void;
};

export default function VideoView({ recordings, onAddRecordings, onGoToSong }: Props) {
  const v = useVideo();
  // The songs available as soundtracks. Stateful so an imported song appears immediately.
  const [songs, setSongs] = useState(() => loadSongs().songs);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(v.project.name);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const chosenSong = songs.find((s) => s.id === v.project.songId) ?? null;
  const songMs = chosenSong ? songDurationMs(chosenSong, recordings) : 0;
  const totalMs = imagesTotalMs(v.project);
  const images = v.project.images;
  const selected = images.find((i) => i.id === selectedImageId) ?? images[0] ?? null;
  const selectedUrl = selected ? v.imageUrls[selected.imageKey] : undefined;

  const commitName = () => {
    setEditingName(false);
    if (draftName.trim() && draftName.trim() !== v.project.name) v.renameActive(draftName.trim());
    else setDraftName(v.project.name);
  };

  // Save the video project (images + the soundtrack song bundle) to a .mwvid file.
  const handleSaveProject = useCallback(async () => {
    setStatusMsg(null);
    const safeName = (v.project.name || "video").replace(/[^\w.-]+/g, "_");
    let path: string | null = null;
    try {
      path = await save({
        defaultPath: `${safeName}.${VIDEO_EXT}`,
        filters: [{ name: "musicware video project", extensions: [VIDEO_EXT] }],
      });
    } catch (e) {
      console.error("save dialog failed", e);
      setStatusMsg("Couldn't open the save dialog.");
      return;
    }
    if (!path) return;
    setBusy(true);
    try {
      const songArr = loadSongs().songs.find((s) => s.id === v.project.songId) ?? null;
      const bundle = await buildVideoBundle(v.project, songArr, recordings);
      await writeFile(path, new TextEncoder().encode(serializeVideoBundle(bundle)));
      setStatusMsg("Video project saved ✓");
    } catch (e) {
      console.error("video project save failed", e);
      setStatusMsg("Couldn't save the project.");
    } finally {
      setBusy(false);
    }
  }, [v.project, recordings]);

  // Open a .mwvid: restore its song (+ recordings) into the libraries, then the video project.
  const handleOpenProject = useCallback(async () => {
    setStatusMsg(null);
    let selected: string | string[] | null = null;
    try {
      selected = await open({ multiple: false, filters: [{ name: "musicware video project", extensions: [VIDEO_EXT] }] });
    } catch (e) {
      console.error("open dialog failed", e);
      setStatusMsg("Couldn't open the file dialog.");
      return;
    }
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (!file) return;
    setBusy(true);
    try {
      const text = new TextDecoder().decode(await readFile(file));
      const bundle = parseVideoBundle(text);
      const { project, song, recordings: recs } = await importVideoBundle(bundle);
      if (song) {
        onAddRecordings(recs);
        addSongToLibrary(song);
        setSongs(loadSongs().songs); // surface the imported song in the picker
      }
      v.importVideoProject(project);
      setSelectedImageId(null);
      setStatusMsg(`Imported "${project.name}" ✓`);
    } catch (e) {
      console.error("video project import failed", e);
      setStatusMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAddRecordings]);

  // Export the clip to a video file (MP4 if the webview supports it, else WebM) — real-time.
  const handleExportVideo = useCallback(async () => {
    setStatusMsg(null);
    if (images.length === 0) {
      setStatusMsg("Add at least one image first.");
      return;
    }
    const picked = pickVideoMime();
    if (!picked) {
      setStatusMsg("This build can't record video.");
      return;
    }
    const safeName = (v.project.name || "video").replace(/[^\w.-]+/g, "_");
    let path: string | null = null;
    try {
      path = await save({
        defaultPath: `${safeName}.${picked.ext}`,
        filters: [{ name: `${picked.ext.toUpperCase()} video`, extensions: [picked.ext] }],
      });
    } catch (e) {
      console.error("save dialog failed", e);
      setStatusMsg("Couldn't open the save dialog.");
      return;
    }
    if (!path) return;
    setBusy(true);
    setStatusMsg("Rendering video… (plays in real time)");
    try {
      const songArr = loadSongs().songs.find((s) => s.id === v.project.songId) ?? null;
      const audioBuffer = songArr ? await renderMixedSong(songArr, recordings) : null;
      const durationMs = audioBuffer ? audioBuffer.duration * 1000 : imagesTotalMs(v.project);
      const imgInputs = images
        .map((i) => ({ url: v.imageUrls[i.imageKey], durationMs: i.durationMs }))
        .filter((i): i is { url: string; durationMs: number } => !!i.url);
      const { blob, ext } = await recordVideo({
        images: imgInputs,
        audioBuffer,
        durationMs,
        onProgress: (f) => setStatusMsg(`Rendering video… ${Math.round(f * 100)}%`),
      });
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      setStatusMsg(`Exported ${ext.toUpperCase()} video ✓`);
    } catch (e) {
      console.error("video export failed", e);
      setStatusMsg(e instanceof Error ? e.message : "Video export failed.");
    } finally {
      setBusy(false);
    }
  }, [images, v.project, v.imageUrls, recordings]);

  return (
    <div className="video-view">
      <div className="video-bar" role="group" aria-label="Video project">
        <span className="song-bar-label">Video</span>
        {editingName ? (
          <input
            className="song-bar-name-input"
            value={draftName}
            autoFocus
            aria-label="Video name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") {
                setDraftName(v.project.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <select
            className="song-bar-select"
            value={v.activeId}
            aria-label="Select video"
            onChange={(e) => v.selectProject(e.target.value)}
          >
            {v.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="song-bar-btn" onClick={v.newProject} aria-label="New video" title="New video">
          ＋ New
        </button>
        <button
          className="song-bar-btn"
          onClick={() => (editingName ? commitName() : (setDraftName(v.project.name), setEditingName(true)))}
          aria-label="Rename video"
          title="Rename"
        >
          ✎
        </button>
        <button
          className="song-bar-btn"
          onClick={() => v.deleteProject(v.activeId)}
          disabled={v.projects.length <= 1}
          aria-label="Delete video"
          title="Delete video"
        >
          🗑
        </button>
        <button
          className="song-bar-btn"
          onClick={handleOpenProject}
          disabled={busy}
          aria-label="Open video project"
          title="Open a .mwvid project"
        >
          📂 Open
        </button>
        <button
          className="song-bar-btn"
          onClick={handleSaveProject}
          disabled={busy}
          aria-label="Save video project"
          title="Save this video project (images + soundtrack) to a .mwvid file"
        >
          💾 Save Project
        </button>

        <span className="video-song-picker">
          <label className="song-bar-label" htmlFor="video-song">
            Soundtrack
          </label>
          <select
            id="video-song"
            className="song-bar-select"
            value={v.project.songId}
            aria-label="Soundtrack song"
            onChange={(e) => v.setSong(e.target.value)}
          >
            <option value="">— pick a song —</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {chosenSong && <span className="video-song-len">{formatDuration(songMs)}</span>}
        </span>
      </div>

      {statusMsg && (
        <p className="song-export-msg" role="status">
          {statusMsg}
        </p>
      )}

      <div className="video-preview" aria-label="Preview">
        {selectedUrl ? (
          <img className="video-preview-img" src={selectedUrl} alt={selected?.name ?? "frame"} />
        ) : (
          <p className="video-preview-empty">
            {images.length === 0 ? "Add images to build your clip." : "Loading…"}
          </p>
        )}
      </div>

      <div className="video-controls">
        <button className="song-bar-btn" onClick={v.importImages} disabled={v.importing} aria-label="Add images">
          {v.importing ? "Adding…" : "🖼 Add images"}
        </button>
        <button
          className="song-bar-btn"
          onClick={() => v.fitToSong(songMs)}
          disabled={images.length === 0 || songMs <= 0}
          aria-label="Fit images to song"
          title="Split the song's length evenly across the images"
        >
          ⤢ Fit to song
        </button>
        <span className="video-len-readout">
          {images.length} image{images.length === 1 ? "" : "s"} · {formatDuration(totalMs)}
          {chosenSong ? ` / ${formatDuration(songMs)} song` : ""}
        </span>
        <button
          className="song-bar-btn video-export-btn"
          onClick={handleExportVideo}
          disabled={busy || images.length === 0}
          aria-label="Export video"
          title="Render this clip to a video file (real time)"
        >
          {busy ? "Working…" : "🎬 Export video"}
        </button>
      </div>

      <ul className="video-strip" aria-label="Image timeline">
        {images.length === 0 ? (
          <li className="video-strip-empty">
            No images yet. {songs.length <= 1 && !chosenSong ? "" : ""}
            <button className="song-bar-btn" onClick={v.importImages}>
              🖼 Add images
            </button>
            <button className="song-bar-btn" onClick={onGoToSong} title="Go make a song to use as the soundtrack">
              Make a song →
            </button>
          </li>
        ) : (
          images.map((img, i) => (
            <li
              key={img.id}
              className={`video-thumb${selected?.id === img.id ? " selected" : ""}`}
              onClick={() => setSelectedImageId(img.id)}
            >
              {v.imageUrls[img.imageKey] ? (
                <img className="video-thumb-img" src={v.imageUrls[img.imageKey]} alt={img.name} />
              ) : (
                <span className="video-thumb-img video-thumb-loading" aria-hidden="true" />
              )}
              <span className="video-thumb-name" title={img.name}>
                {img.name}
              </span>
              <span className="video-thumb-row">
                <input
                  className="video-dur-input"
                  type="number"
                  min={0.2}
                  step={0.5}
                  value={(img.durationMs / 1000).toFixed(1)}
                  aria-label={`Duration of ${img.name} in seconds`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => v.setImageDuration(img.id, (Number(e.target.value) || 0) * 1000)}
                />
                <span className="video-dur-unit">s</span>
              </span>
              <span className="video-thumb-actions">
                <button
                  className="clip-stepper-btn"
                  aria-label={`Move ${img.name} left`}
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    v.reorderImage(img.id, "left");
                  }}
                >
                  ‹
                </button>
                <button
                  className="clip-stepper-btn"
                  aria-label={`Move ${img.name} right`}
                  disabled={i === images.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    v.reorderImage(img.id, "right");
                  }}
                >
                  ›
                </button>
                <button
                  className="clip-stepper-btn video-thumb-del"
                  aria-label={`Remove ${img.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    v.removeImage(img.id);
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
