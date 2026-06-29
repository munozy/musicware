import { useCallback, useEffect, useRef, useState } from "react";
import {
  flattenArrangement,
  playArrangement,
  voiceClipPlays,
  type Arrangement,
  type Player,
  type ScheduledEvent,
} from "./arrangement";
import { loadVoiceBuffer, playVoice, type VoiceHandle } from "./voiceAudio";
import { loadSongs, saveSongs, createSong } from "./songsStore";
import {
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
  setClipTrim as setClipTrimStore,
  setClipEffect as setClipEffectStore,
} from "./arrangementStore";
import { emit } from "./synth";
import { isVoice, type Recording, type VoiceEffect } from "./recordings";

/**
 * State hook for the Song arrangement — mirrors useRecorder shape.
 * Owns the in-memory Arrangement, persists on every change, and manages the
 * arrangement Player lifecycle (play/stop + no-stranded-note guarantee).
 */
export function useArrangement() {
  // The song LIBRARY (CRUD) + the active song id. The exposed `arrangement` is the active
  // song; every mutation below updates it within the list via the stable `setArrangement`.
  const initial = useState(() => loadSongs())[0];
  const [songs, setSongs] = useState<Arrangement[]>(initial.songs);
  const [activeSongId, setActiveSongId] = useState<string>(initial.activeId);
  const activeIdRef = useRef(activeSongId);
  activeIdRef.current = activeSongId;

  const arrangement = songs.find((s) => s.id === activeSongId) ?? songs[0];

  // Drop-in replacement for the old useState setter: applies the update to the ACTIVE song.
  // Stable (reads the active id from a ref) so the mutation callbacks keep empty deps.
  const setArrangement = useCallback((updater: Arrangement | ((prev: Arrangement) => Arrangement)) => {
    setSongs((prev) =>
      prev.map((s) =>
        s.id === activeIdRef.current ? (typeof updater === "function" ? (updater as (p: Arrangement) => Arrangement)(s) : updater) : s,
      ),
    );
  }, []);

  const [isPlaying, setIsPlaying] = useState(false);
  // Wall-clock (performance.now) at playback start; drives the animated playhead. Null when stopped.
  const [playStartedAt, setPlayStartedAt] = useState<number | null>(null);

  const playerRef = useRef<Player | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Voice (audio) clips play on a parallel path (ADR-0009): per-clip start timers + the
  // live Web Audio handles, both torn down on stop so audio never outlives playback.
  const voiceTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const voiceHandlesRef = useRef<VoiceHandle[]>([]);

  // Per-recording preview (shelf ▶). Separate player from arrangement playback.
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewRef = useRef<Player | null>(null);
  const voicePreviewRef = useRef<VoiceHandle | null>(null);
  const previewEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The take a preview is INTENDED for — guards the async voice decode against a newer
  // preview that superseded it before its buffer finished decoding.
  const previewIntentRef = useRef<string | null>(null);

  // Persist the whole library + active id on any change (mirrors useRecorder).
  useEffect(() => {
    saveSongs(songs, activeSongId);
  }, [songs, activeSongId]);

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
  const trimClip = useCallback(
    (clipId: string, patch: { startMs?: number; trimStartMs?: number; trimEndMs?: number }) => {
      setArrangement((prev) => setClipTrimStore(prev, clipId, patch));
    },
    [],
  );
  const setClipEffect = useCallback((clipId: string, effect: VoiceEffect) => {
    setArrangement((prev) => setClipEffectStore(prev, clipId, effect));
  }, []);

  /** Stop any in-progress recording preview and release its notes / voice audio. */
  const stopPreview = useCallback(() => {
    if (previewEndRef.current) {
      clearTimeout(previewEndRef.current);
      previewEndRef.current = null;
    }
    if (previewRef.current) {
      previewRef.current.stop();
      previewRef.current = null;
    }
    if (voicePreviewRef.current) {
      voicePreviewRef.current.stop();
      voicePreviewRef.current = null;
    }
    previewIntentRef.current = null;
    setPreviewingId(null);
  }, []);

  /** Cancel pending voice-clip starts and stop any voice audio still playing. */
  const stopVoiceClips = useCallback(() => {
    for (const id of voiceTimersRef.current) clearTimeout(id);
    voiceTimersRef.current = [];
    for (const h of voiceHandlesRef.current) h.stop();
    voiceHandlesRef.current = [];
  }, []);

  /** Internal stop — releases all held notes + voice audio and clears state. */
  const stopInternal = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    stopVoiceClips();
    setIsPlaying(false);
    setPlayStartedAt(null);
  }, [stopVoiceClips]);

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

      // Voice (audio) clips: schedule each on the SAME wall-clock as the symbolic scheduler
      // (setTimeout from playback start), decoding + playing the buffer through its effect.
      // A loop replays the buffer; transpose is a no-op for audio (noted in ADR-0009).
      let endMs = events.length > 0 ? events[events.length - 1].t : 0;
      for (const vp of voiceClipPlays(arrangement, recordings)) {
        for (let k = 0; k < vp.loopCount; k++) {
          const at = vp.startMs + k * vp.durationMs;
          endMs = Math.max(endMs, at + vp.durationMs);
          const timer = setTimeout(() => {
            void loadVoiceBuffer(vp.blobKey).then((buf) => {
              if (!buf || !playerRef.current) return; // stopped before the buffer decoded
              voiceHandlesRef.current.push(playVoice(buf, vp.effect));
            });
          }, at);
          voiceTimersRef.current.push(timer);
        }
      }

      // Clear the playing flag + stop voice audio just after the final event (mirrors
      // useRecorder's end timer); endMs spans both the symbolic stream and voice clips.
      endTimerRef.current = setTimeout(() => {
        playerRef.current = null;
        endTimerRef.current = null;
        stopVoiceClips();
        setIsPlaying(false);
        setPlayStartedAt(null);
      }, endMs + 1);
    },
    [arrangement, stopVoiceClips],
  );

  /** Stop playback and release held notes (no stuck note guarantee). */
  const stop = useCallback(() => {
    stopInternal();
  }, [stopInternal]);

  /** Preview a single saved recording (shelf ▶); clicking the playing one stops it. */
  const previewRecording = useCallback(
    (rec: Recording) => {
      const playingThis = previewingId === rec.id && (previewRef.current || voicePreviewRef.current);
      if (playingThis) {
        stopPreview();
        return;
      }
      stopPreview();
      stopInternal(); // don't overlap a preview with arrangement playback
      previewIntentRef.current = rec.id;

      // Voice take → audio path (decode + effect chain); keyboard take → symbolic replay.
      if (isVoice(rec) && rec.audio) {
        const { effect, blobKey } = rec.audio;
        setPreviewingId(rec.id); // optimistic — the decode is async
        void loadVoiceBuffer(blobKey).then((buf) => {
          if (previewIntentRef.current !== rec.id) return; // a newer preview superseded this
          if (!buf) {
            previewIntentRef.current = null;
            setPreviewingId(null);
            return;
          }
          voicePreviewRef.current = playVoice(buf, effect, () => {
            voicePreviewRef.current = null;
            setPreviewingId((cur) => (cur === rec.id ? null : cur));
          });
        });
        return;
      }

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

  // ---- Song library CRUD ----

  /** Create a new empty song ("Song N") and switch to it. */
  const newSong = useCallback(() => {
    stopInternal();
    stopPreview();
    setSongs((prev) => {
      const song = createSong(prev);
      setActiveSongId(song.id);
      return [...prev, song];
    });
  }, [stopInternal, stopPreview]);

  /** Switch the active song (stops playback first so a player can't carry across songs). */
  const selectSong = useCallback(
    (id: string) => {
      stopInternal();
      stopPreview();
      setActiveSongId(id);
    },
    [stopInternal, stopPreview],
  );

  /** Rename a song. Empty/whitespace ignored. */
  const renameSong = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
  }, []);

  /** Delete a song. Refuses the last one; if the active song goes, fall back to the first remaining. */
  const deleteSong = useCallback(
    (id: string) => {
      stopInternal();
      stopPreview();
      setSongs((prev) => {
        if (prev.length <= 1) return prev; // always keep at least one song
        const next = prev.filter((s) => s.id !== id);
        if (id === activeIdRef.current) setActiveSongId(next[0].id);
        return next;
      });
    },
    [stopInternal, stopPreview],
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
    stopPreview,
    play,
    stop,
  };
}
