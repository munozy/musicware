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
import { renderSongFile, songHasContent, ExportTooLongError, type ExportFormat } from "./exportSong";
import { playedMsFor, type Section } from "./arrangement";
import { gridMsFor, type SnapDivision } from "./timeScale";
import { suggestForSection, type Suggestion } from "./suggest";
import { formatDuration } from "./recordings";
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
    seekMs,
    loopRegion,
    loopEnabled,
    playOriginMs,
    playLoopLenMs,
    seekTo,
    setLoopRegion,
    toggleLoop,
    previewingId,
    placeClip,
    placeSuggestion,
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
    moveClips,
    removeClips,
    duplicateClips,
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

  // ---- Multi-select (Slice 8): a set of selected clip ids + group-aware move/delete/duplicate ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const allClips = arrangement.tracks.flatMap((t) => t.clips);
  // Prune stale ids (a clip may have been deleted/undone) so the count + ops stay honest.
  const liveSelected = allClips.filter((c) => selectedIds.has(c.id)).map((c) => c.id);
  const isGroup = (id: string) => selectedIds.has(id) && liveSelected.length > 1;

  const selectClip = useCallback((id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) return new Set([id]);
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Rubber-band result (Slice 8b): replace the selection with the covered ids, or union them
  // in when the drag was additive (Shift/⌘/Ctrl). An empty non-additive marquee clears.
  const marqueeSelect = useCallback((ids: string[], additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) return new Set(ids);
      const n = new Set(prev);
      ids.forEach((id) => n.add(id));
      return n;
    });
  }, []);

  const deleteSelection = useCallback(() => {
    removeClips(liveSelected);
    setSelectedIds(new Set());
  }, [removeClips, liveSelected]);

  const duplicateSelection = useCallback(() => {
    const clips = allClips.filter((c) => selectedIds.has(c.id));
    if (clips.length === 0) return;
    // playedMsFor = the effect-aware audible length (same maths as the block width/scheduler).
    const playedOf = (c: (typeof clips)[number]) => {
      const rec = recordings.find((r) => r.id === c.recordingId);
      return rec ? playedMsFor(c, rec) : 0;
    };
    const minStart = Math.min(...clips.map((c) => c.startMs));
    const maxEnd = Math.max(...clips.map((c) => c.startMs + playedOf(c)));
    const offset = Math.max(0, maxEnd - minStart); // drop the copies right after the group
    duplicateClips(clips.map((c) => ({ clipId: c.id, atMs: c.startMs + offset })));
  }, [allClips, selectedIds, recordings, duplicateClips]);

  // Group-aware clip ops: when the acted-on clip is part of a multi-selection, the action
  // applies to the whole group; otherwise it's a normal single-clip op.
  const handleMoveClip = useCallback(
    (id: string, startMs: number) => {
      if (isGroup(id)) {
        const c = allClips.find((x) => x.id === id);
        if (c) moveClips(liveSelected, startMs - c.startMs);
        else moveClip(id, startMs);
      } else moveClip(id, startMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, allClips, moveClip, moveClips],
  );
  const handleRemoveClip = useCallback(
    (id: string) => {
      if (isGroup(id)) deleteSelection();
      else removeClip(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, deleteSelection, removeClip],
  );
  const handleDuplicateClip = useCallback(
    (id: string, atMs: number) => {
      if (isGroup(id)) duplicateSelection();
      else duplicateClip(id, atMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, duplicateSelection, duplicateClip],
  );

  // ---- "Suggest what fits" (Slice 9): heuristic candidates for a section ----
  const [suggestState, setSuggestState] = useState<{ section: Section; items: Suggestion[] } | null>(null);
  const handleSuggestSection = useCallback(
    (section: Section) => {
      setSuggestState({ section, items: suggestForSection(section.endMs - section.startMs, recordings) });
    },
    [recordings],
  );
  const placeSuggested = useCallback(
    (s: Suggestion) => {
      if (!suggestState) return;
      const trackId = arrangement.tracks[0]?.id;
      if (trackId) placeSuggestion(trackId, s.recording.id, suggestState.section.startMs, s.loopCount);
      setSuggestState(null);
    },
    [suggestState, arrangement, placeSuggestion],
  );

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
        // The length guard writes a user-facing message; everything else stays generic.
        setExportMsg(e instanceof ExportTooLongError ? e.message : "Export failed.");
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
        seekMs={seekMs}
        loopRegion={loopRegion}
        loopEnabled={loopEnabled}
        onToggleLoop={toggleLoop}
        onClearSeek={() => seekTo(0)}
        onClearLoop={() => setLoopRegion(null)}
      />
      {suggestState && (
        <div className="suggest-panel" role="dialog" aria-label="Suggestions">
          <div className="suggest-head">
            <span>
              Suggestions for <b>{suggestState.section.name}</b> (
              {formatDuration(suggestState.section.endMs - suggestState.section.startMs)})
            </span>
            <button className="song-bar-btn" onClick={() => setSuggestState(null)} aria-label="Close suggestions">
              ×
            </button>
          </div>
          {suggestState.items.length === 0 ? (
            <p className="suggest-empty">No recordings to suggest yet — record some clips first.</p>
          ) : (
            <ul className="suggest-list">
              {suggestState.items.map((s) => (
                <li key={s.recording.id}>
                  <button className="suggest-item" onClick={() => placeSuggested(s)}>
                    <span className="suggest-name">{s.recording.name}</span>
                    <span className="suggest-reason">{s.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {liveSelected.length > 0 && (
        <div className="selection-bar" role="group" aria-label="Selection actions">
          <span className="selection-count">{liveSelected.length} selected</span>
          <button className="song-bar-btn" onClick={duplicateSelection} aria-label="Duplicate selection">
            ⧉ Duplicate
          </button>
          <button className="song-bar-btn" onClick={deleteSelection} aria-label="Delete selection">
            ✕ Delete
          </button>
          <button className="song-bar-btn" onClick={clearSelection} aria-label="Clear selection">
            Clear
          </button>
        </div>
      )}
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
            onMoveClip: handleMoveClip,
            onRemoveClip: handleRemoveClip,
            onToggleClipMute: toggleClipMute,
            onDuplicateClip: handleDuplicateClip,
            onSetClipLoop: setClipLoop,
            onTransposeClip: transposeClip,
            onTrimClip: trimClip,
            onSetClipEffect: setClipEffect,
          }}
          selection={{
            selectedIds,
            onSelectClip: selectClip,
            onClearSelection: clearSelection,
            onMarqueeSelect: marqueeSelect,
          }}
          seekMs={seekMs}
          loopRegion={loopRegion}
          loopEnabled={loopEnabled}
          playOriginMs={playOriginMs}
          playLoopLenMs={playLoopLenMs}
          onSeek={seekTo}
          onSetLoopRegion={setLoopRegion}
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
            onSuggestSection: handleSuggestSection,
          }}
        />
      </div>
    </div>
  );
}
