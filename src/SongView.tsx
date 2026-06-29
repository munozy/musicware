/**
 * SongView — song-mode shell. Composes ClipShelf (left), SongTransport (top),
 * and Timeline (centre). Owns nothing — wires useArrangement to children.
 *
 * If recordings is empty, shows the DESIGN-002 §9 interstitial.
 */

import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useArrangement } from "./useArrangement";
import ClipShelf from "./ClipShelf";
import Timeline from "./Timeline";
import SongTransport from "./SongTransport";
import SongBar from "./SongBar";
import { renderSongFile, songHasContent, type ExportFormat } from "./exportSong";
import type { Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onGoToPlay: () => void;
};

export default function SongView({ recordings, onGoToPlay }: Props) {
  const {
    arrangement,
    songs,
    activeSongId,
    newSong,
    selectSong,
    renameSong,
    deleteSong,
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
    previewRecording,
    play,
    stop,
  } = useArrangement();

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (!songHasContent(arrangement, recordings)) {
      setExportMsg("Nothing to export yet — add some clips first.");
      return;
    }
    setExportMsg(null);
    const safeName = (arrangement.name || "song").replace(/[^\w.-]+/g, "_");
    let path: string | null = null;
    try {
      path = await save({
        defaultPath: `${safeName}.mp3`,
        filters: [
          { name: "MP3 audio", extensions: ["mp3"] },
          { name: "WAV audio", extensions: ["wav"] },
        ],
      });
    } catch (e) {
      console.error("save dialog failed", e);
      setExportMsg("Couldn't open the save dialog.");
      return;
    }
    if (!path) return; // user cancelled

    setExporting(true);
    try {
      const format: ExportFormat = path.toLowerCase().endsWith(".wav") ? "wav" : "mp3";
      const bytes = await renderSongFile(arrangement, recordings, format);
      await writeFile(path, bytes);
      setExportMsg(`Exported ${format.toUpperCase()} ✓`);
    } catch (e) {
      console.error("export failed", e);
      setExportMsg("Export failed.");
    } finally {
      setExporting(false);
    }
  }, [arrangement, recordings]);

  if (recordings.length === 0) {
    return (
      <div className="song-interstitial">
        <p>You haven&apos;t recorded anything yet.</p>
        <button
          className="song-go-record-btn"
          aria-label="Go record"
          onClick={onGoToPlay}
        >
          Go record →
        </button>
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
        />
      </div>
    </div>
  );
}
