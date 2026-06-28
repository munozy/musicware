import { useCallback, useEffect, useRef, useState } from "react";
import {
  flattenArrangement,
  playArrangement,
  type Arrangement,
  type Player,
  type ScheduledEvent,
} from "./arrangement";
import {
  loadArrangement,
  saveArrangement,
  addClip,
  moveClip as moveClipStore,
  addTrack as addTrackStore,
  renameTrack as renameTrackStore,
  setTrackColor as setTrackColorStore,
  reorderTrack as reorderTrackStore,
  removeTrack as removeTrackStore,
  removeClip as removeClipStore,
  toggleTrackMuted as toggleTrackMutedStore,
  toggleTrackSoloed as toggleTrackSoloedStore,
  toggleClipMuted as toggleClipMutedStore,
  duplicateClip as duplicateClipStore,
  setClipLoopCount as setClipLoopCountStore,
  setClipTranspose as setClipTransposeStore,
} from "./arrangementStore";
import { emit } from "./synth";
import type { Recording } from "./recordings";

/**
 * State hook for the Song arrangement — mirrors useRecorder shape.
 * Owns the in-memory Arrangement, persists on every change, and manages the
 * arrangement Player lifecycle (play/stop + no-stranded-note guarantee).
 */
export function useArrangement() {
  const [arrangement, setArrangement] = useState<Arrangement>(() => loadArrangement());
  const [isPlaying, setIsPlaying] = useState(false);
  // Wall-clock (performance.now) at playback start; drives the animated playhead. Null when stopped.
  const [playStartedAt, setPlayStartedAt] = useState<number | null>(null);

  const playerRef = useRef<Player | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-recording preview (shelf ▶). Separate player from arrangement playback.
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewRef = useRef<Player | null>(null);
  const previewEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist arrangement to localStorage on every change (mirrors useRecorder).
  useEffect(() => {
    saveArrangement(arrangement);
  }, [arrangement]);

  /** Place a recording clip on a track at an absolute ms position. */
  const placeClip = useCallback((trackId: string, recordingId: string, startMs: number) => {
    setArrangement((prev) => addClip(prev, trackId, recordingId, startMs));
  }, []);

  /** Move an already-placed clip to a new time (clamped >= 0). The headline edit (US-12). */
  const moveClip = useCallback((clipId: string, startMs: number) => {
    setArrangement((prev) => moveClipStore(prev, clipId, startMs));
  }, []);

  /** Track management (Slice 3, US-3/4/5/6/10). */
  const addTrack = useCallback(() => setArrangement((prev) => addTrackStore(prev)), []);
  const renameTrack = useCallback(
    (trackId: string, name: string) => setArrangement((prev) => renameTrackStore(prev, trackId, name)),
    [],
  );
  const setTrackColor = useCallback(
    (trackId: string, color: string) => setArrangement((prev) => setTrackColorStore(prev, trackId, color)),
    [],
  );
  const reorderTrack = useCallback(
    (trackId: string, dir: "up" | "down") => setArrangement((prev) => reorderTrackStore(prev, trackId, dir)),
    [],
  );
  const removeTrack = useCallback(
    (trackId: string) => setArrangement((prev) => removeTrackStore(prev, trackId)),
    [],
  );

  /** Remove a placed clip from the timeline (US-14, pulled forward from Slice 5). */
  const removeClip = useCallback((clipId: string) => {
    setArrangement((prev) => removeClipStore(prev, clipId));
  }, []);

  /** Mute / solo a track (US-7/8). flattenArrangement already honours both flags. */
  const toggleMute = useCallback((trackId: string) => {
    setArrangement((prev) => toggleTrackMutedStore(prev, trackId));
  }, []);
  const toggleSolo = useCallback((trackId: string) => {
    setArrangement((prev) => toggleTrackSoloedStore(prev, trackId));
  }, []);
  /** Mute / unmute a single placed clip (per-brick). */
  const toggleClipMute = useCallback((clipId: string) => {
    setArrangement((prev) => toggleClipMutedStore(prev, clipId));
  }, []);

  /** Clip editing (Slice 5, US-13/15/16). The scheduler already honours every field. */
  const duplicateClip = useCallback((clipId: string, atMs: number) => {
    setArrangement((prev) => duplicateClipStore(prev, clipId, atMs));
  }, []);
  const setClipLoop = useCallback((clipId: string, count: number) => {
    setArrangement((prev) => setClipLoopCountStore(prev, clipId, count));
  }, []);
  const transposeClip = useCallback((clipId: string, semitones: number) => {
    setArrangement((prev) => setClipTransposeStore(prev, clipId, semitones));
  }, []);

  /** Stop any in-progress recording preview and release its notes. */
  const stopPreview = useCallback(() => {
    if (previewEndRef.current) {
      clearTimeout(previewEndRef.current);
      previewEndRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.stop();
      previewRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  /** Internal stop — releases all held notes and clears state. */
  const stopInternal = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    setIsPlaying(false);
    setPlayStartedAt(null);
  }, []);

  /**
   * Flatten the arrangement and start playback via playArrangement.
   * Guard: no-op if already playing.
   */
  const play = useCallback(
    (recordings: Recording[]) => {
      if (playerRef.current && !playerRef.current.stopped) return;

      const events = flattenArrangement(arrangement, recordings);
      const player = playArrangement(events, emit);
      playerRef.current = player;
      setIsPlaying(true);
      setPlayStartedAt(performance.now());

      // Clear the playing flag just after the final event (mirrors useRecorder's end timer).
      const lastT = events.length > 0 ? events[events.length - 1].t : 0;
      endTimerRef.current = setTimeout(() => {
        playerRef.current = null;
        endTimerRef.current = null;
        setIsPlaying(false);
        setPlayStartedAt(null);
      }, lastT + 1);
    },
    [arrangement],
  );

  /** Stop playback and release held notes (no stuck note guarantee). */
  const stop = useCallback(() => {
    stopInternal();
  }, [stopInternal]);

  /** Preview a single saved recording (shelf ▶); clicking the playing one stops it. */
  const previewRecording = useCallback(
    (rec: Recording) => {
      if (previewRef.current && !previewRef.current.stopped && previewingId === rec.id) {
        stopPreview();
        return;
      }
      stopPreview();
      stopInternal(); // don't overlap a preview with arrangement playback
      const events = [...rec.events].sort((a, b) => a.t - b.t) as ScheduledEvent[];
      previewRef.current = playArrangement(events, emit);
      setPreviewingId(rec.id);
      const lastT = events.length > 0 ? events[events.length - 1].t : 0;
      previewEndRef.current = setTimeout(() => {
        previewRef.current = null;
        previewEndRef.current = null;
        setPreviewingId(null);
      }, lastT + 1);
    },
    [previewingId, stopPreview, stopInternal],
  );

  // Release notes on unmount (HMR / mode switch) — mirrors useRecorder cleanup.
  useEffect(() => {
    return () => {
      stopInternal();
      stopPreview();
    };
  }, [stopInternal, stopPreview]);

  return {
    arrangement,
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
    previewRecording,
    stopPreview,
    play,
    stop,
  };
}
