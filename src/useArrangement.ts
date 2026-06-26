import { useCallback, useEffect, useRef, useState } from "react";
import { flattenArrangement, playArrangement, type Arrangement, type Player } from "./arrangement";
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

  const playerRef = useRef<Player | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Clear the playing flag just after the final event (mirrors useRecorder's end timer).
      const lastT = events.length > 0 ? events[events.length - 1].t : 0;
      endTimerRef.current = setTimeout(() => {
        playerRef.current = null;
        endTimerRef.current = null;
        setIsPlaying(false);
      }, lastT + 1);
    },
    [arrangement],
  );

  /** Stop playback and release held notes (no stuck note guarantee). */
  const stop = useCallback(() => {
    stopInternal();
  }, [stopInternal]);

  // Release notes on unmount (HMR / mode switch) — mirrors useRecorder cleanup.
  useEffect(() => {
    return () => {
      stopInternal();
    };
  }, [stopInternal]);

  return {
    arrangement,
    isPlaying,
    placeClip,
    moveClip,
    addTrack,
    renameTrack,
    setTrackColor,
    reorderTrack,
    removeTrack,
    play,
    stop,
  };
}
