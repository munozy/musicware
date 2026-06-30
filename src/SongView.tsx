/**
 * SongView — song-mode shell. Composes ClipShelf (left), SongTransport (top),
 * and Timeline (centre). Owns nothing — wires useArrangement to children.
 *
 * If recordings is empty, shows the DESIGN-002 §9 interstitial.
 */

import { useCallback, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useArrangement } from "./useArrangement";
import ClipShelf from "./ClipShelf";
import Timeline from "./Timeline";
import SongTransport from "./SongTransport";
import SongBar from "./SongBar";
import { renderSongFile, songHasContent, type ExportFormat } from "./exportSong";
import { gridMsFor, type SnapDivision } from "./timeScale";
import {
  buildProjectBundle,
  serializeProject,
  parseProjectBundle,
  importProjectBundle,
  PROJECT_EXT,
} from "./songProject";
import type { Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onAddRecordings: (recs: Recording[]) => void;
  onGoToPlay: () => void;
};

export default function SongView({ recordings, onAddRecordings, onGoToPlay }: Props) {
  const {
    arrangement,
    songs,
    activeSongId,
    newSong,
    selectSong,
    renameSong,
    deleteSong,
    importSong,
    isPlaying,
    playStartedAt,
    previewingId,
    placeClip,
    moveClip,
    removeClip,
    addTrack,
    renameTrack,
    setTrackColor,
    reorderTrack,
    removeTrack,
    toggleMute,
    toggleSolo,
    toggleClipMute,
    duplicateClip,
    setClipLoop,
    transposeClip,
    trimClip,
    setClipEffect,
    setTempo,
    setBeatsPerBar,
    addSection,
    renameSection,
    moveSection,
    resizeSection,
    removeSection,
    applyTemplate,
    previewRecording,
    play,
    stop,
  } = useArrangement();

  const [snap, setSnap] = useState<SnapDivision>("beat");
  const beatsPerBar = arrangement.timeSig?.[0] ?? 4;
  const gridMs = gridMsFor(snap, arrangement.tempoBpm, beatsPerBar);

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!songHasContent(arrangement, recordings)) {
        setExportMsg("Nothing to export yet — add some clips first.");
        return;
      }
      setExportMsg(null);
      const safeName = (arrangement.name || "song").replace(/[^\w.-]+/g, "_");
      const filterName = format === "wav" ? "WAV audio" : "MP3 audio";
      let path: string | null = null;
      try {
        path = await save({
          defaultPath: `${safeName}.${format}`,
          filters: [{ name: filterName, extensions: [format] }],
        });
      } catch (e) {
        console.error("save dialog failed", e);
        setExportMsg("Couldn't open the save dialog.");
        return;
      }
      if (!path) return; // user cancelled

      setExporting(true);
      try {
        const bytes = await renderSongFile(arrangement, recordings, format);
        await writeFile(path, bytes);
        setExportMsg(`Exported ${format.toUpperCase()} ✓`);
      } catch (e) {
        console.error("export failed", e);
        setExportMsg("Export failed.");
      } finally {
        setExporting(false);
      }
    },
    [arrangement, recordings],
  );

  // Export the editable PROJECT (song + the recordings it needs) to a .mwsong file.
  const handleExportProject = useCallback(async () => {
    setExportMsg(null);
    const safeName = (arrangement.name || "song").replace(/[^\w.-]+/g, "_");
    let path: string | null = null;
    try {
      path = await save({
        defaultPath: `${safeName}.${PROJECT_EXT}`,
        filters: [{ name: "musicware project", extensions: [PROJECT_EXT] }],
      });
    } catch (e) {
      console.error("save dialog failed", e);
      setExportMsg("Couldn't open the save dialog.");
      return;
    }
    if (!path) return;
    setExporting(true);
    try {
      const bundle = await buildProjectBundle(arrangement, recordings);
      await writeFile(path, new TextEncoder().encode(serializeProject(bundle)));
      setExportMsg("Project saved ✓");
    } catch (e) {
      console.error("project export failed", e);
      setExportMsg("Couldn't save the project.");
    } finally {
      setExporting(false);
    }
  }, [arrangement, recordings]);

  // Import a .mwsong project: restore its recordings (fresh ids/blobs) + add it as a new song.
  const handleImportProject = useCallback(async () => {
    setExportMsg(null);
    let selected: string | string[] | null = null;
    try {
      selected = await open({ multiple: false, filters: [{ name: "musicware project", extensions: [PROJECT_EXT] }] });
    } catch (e) {
      console.error("open dialog failed", e);
      setExportMsg("Couldn't open the file dialog.");
      return;
    }
    const file = Array.isArray(selected) ? selected[0] : selected;
    if (!file) return;
    setExporting(true);
    try {
      const text = new TextDecoder().decode(await readFile(file));
      const bundle = parseProjectBundle(text);
      const { song, recordings: imported } = await importProjectBundle(bundle);
      onAddRecordings(imported);
      importSong(song);
      setExportMsg(`Imported "${song.name}" ✓`);
    } catch (e) {
      console.error("project import failed", e);
      setExportMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setExporting(false);
    }
  }, [onAddRecordings, importSong]);

  if (recordings.length === 0) {
    return (
      <div className="song-interstitial">
        <p>You haven&apos;t recorded anything yet.</p>
        <div className="song-interstitial-actions">
          <button className="song-go-record-btn" aria-label="Go record" onClick={onGoToPlay}>
            Go record →
          </button>
          <button
            className="song-bar-btn"
            aria-label="Open project"
            onClick={handleImportProject}
            disabled={exporting}
          >
            📂 Open a project
          </button>
        </div>
        {exportMsg && (
          <p className="song-export-msg" role="status">
            {exportMsg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="song-view">
      <SongBar
        songs={songs.map((s) => ({ id: s.id, name: s.name }))}
        activeSongId={activeSongId}
        onSelect={selectSong}
        onNew={newSong}
        onRename={renameSong}
        onDelete={deleteSong}
        onExport={handleExport}
        onExportProject={handleExportProject}
        onImportProject={handleImportProject}
        exporting={exporting}
      />
      {exportMsg && (
        <p className="song-export-msg" role="status">
          {exportMsg}
        </p>
      )}
      <SongTransport
        isPlaying={isPlaying}
        onPlay={play}
        onStop={stop}
        recordings={recordings}
        tempoBpm={arrangement.tempoBpm}
        beatsPerBar={beatsPerBar}
        snap={snap}
        onSetTempo={setTempo}
        onSetBeatsPerBar={setBeatsPerBar}
        onSetSnap={setSnap}
      />
      <div className="song-body">
        <ClipShelf
          recordings={recordings}
          trackIds={arrangement.tracks.map((t) => t.id)}
          onPlaceClip={placeClip}
          onPreview={previewRecording}
          previewingId={previewingId}
        />
        <Timeline
          arrangement={arrangement}
          recordings={recordings}
          isPlaying={isPlaying}
          playStartedAt={playStartedAt}
          gridMs={gridMs}
          onPlaceClip={placeClip}
          clipOps={{
            onMoveClip: moveClip,
            onRemoveClip: removeClip,
            onToggleClipMute: toggleClipMute,
            onDuplicateClip: duplicateClip,
            onSetClipLoop: setClipLoop,
            onTransposeClip: transposeClip,
            onTrimClip: trimClip,
            onSetClipEffect: setClipEffect,
          }}
          trackOps={{
            onAddTrack: addTrack,
            onRenameTrack: renameTrack,
            onSetTrackColor: setTrackColor,
            onReorderTrack: reorderTrack,
            onRemoveTrack: removeTrack,
            onToggleMute: toggleMute,
            onToggleSolo: toggleSolo,
          }}
          sectionOps={{
            onAddSection: addSection,
            onRenameSection: renameSection,
            onMoveSection: moveSection,
            onResizeSection: resizeSection,
            onRemoveSection: removeSection,
            onApplyTemplate: applyTemplate,
          }}
        />
      </div>
    </div>
  );
}
