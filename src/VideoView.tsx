/**
 * VideoView — the Video-clip composer (ADR-0010). Pick a saved song as the soundtrack, import
 * images, order them with per-image durations (auto "fit to song" even-split), and preview the
 * selected frame. Stage 1: compose + CRUD + persistence (playback preview, save/open, and MP4
 * export come next). State lives in useVideo; the song list is read from the songs library.
 */

import { useMemo, useState } from "react";
import { useVideo } from "./useVideo";
import { loadSongs } from "./songsStore";
import { songDurationMs } from "./exportSong";
import { imagesTotalMs } from "./videoStore";
import { formatDuration, type Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onGoToSong: () => void;
};

export default function VideoView({ recordings, onGoToSong }: Props) {
  const v = useVideo();
  // Snapshot the songs for the soundtrack picker (re-read each time the Video section mounts).
  const songs = useMemo(() => loadSongs().songs, []);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(v.project.name);

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
