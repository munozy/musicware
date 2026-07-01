import { useCallback, useEffect, useRef, useState } from "react";
import {
  flattenArrangement,
  buildPlaybackStream,
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
  moveClips as moveClipsStore,
  removeClips as removeClipsStore,
  duplicateClips as duplicateClipsStore,
  setTempo as setTempoStore,
  setBeatsPerBar as setBeatsPerBarStore,
  addSection as addSectionStore,
  renameSection as renameSectionStore,
  moveSection as moveSectionStore,
  resizeSection as resizeSectionStore,
  removeSection as removeSectionStore,
  applyTemplate as applyTemplateStore,
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

  // Seek + loop-region (Slice 7b). Transient view state — not part of the saved song.
  //  - seekMs: where a fresh Play starts from (0 = top).
  //  - loopRegion: the [start,end) window to repeat; null = none.
  //  - loopEnabled: whether the region is armed (the transport 🔁 toggle).
  // playOrigin/playLoopLen capture the geometry of the CURRENT run so the playhead can map
  // playback time back to an absolute timeline position (and wrap within the loop).
  const [seekMs, setSeekMsState] = useState(0);
  const [loopRegion, setLoopRegionState] = useState<{ startMs: number; endMs: number } | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [playOriginMs, setPlayOriginMs] = useState(0);
  const [playLoopLenMs, setPlayLoopLenMs] = useState(0);

  const playerRef = useRef<Player | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Voice (audio) clips play on a parallel path (ADR-0009): per-clip start timers + the
  // live Web Audio handles, both torn down on stop so audio never outlives playback.
  const voiceTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const voiceHandlesRef = useRef<VoiceHandle[]>([]);
  // Run generation (DEBT-034): a voice buffer decode is async, so a decode scheduled by run A
  // could resolve after a stop→play into run B and attach stale audio. Every run captures this
  // token; a stop bumps it, so an in-flight decode from a superseded run bails instead of playing.
  const playGenRef = useRef(0);

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

  /** Place a clip pre-looped to fill a section (Slice 9 "Suggest what fits"). */
  const placeSuggestion = useCallback(
    (trackId: string, recordingId: string, startMs: number, loopCount: number) => {
      setArrangement((prev) => addClip(prev, trackId, recordingId, startMs, loopCount));
    },
    [],
  );

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

  /** Multi-select group ops (Slice 8). */
  const moveClips = useCallback((ids: string[], deltaMs: number) => {
    setArrangement((prev) => moveClipsStore(prev, ids, deltaMs));
  }, []);
  const removeClips = useCallback((ids: string[]) => {
    setArrangement((prev) => removeClipsStore(prev, ids));
  }, []);
  const duplicateClips = useCallback((specs: { clipId: string; atMs: number }[]) => {
    setArrangement((prev) => duplicateClipsStore(prev, specs));
  }, []);

  /** Transport / grid — tempo + time signature (Slice 7). */
  const setTempo = useCallback((bpm: number) => setArrangement((prev) => setTempoStore(prev, bpm)), []);
  const setBeatsPerBar = useCallback((beats: number) => setArrangement((prev) => setBeatsPerBarStore(prev, beats)), []);

  /** Song structure — section markers + genre templates (Slice 6). Visual-only. */
  const addSection = useCallback((startMs: number, endMs: number) => {
    setArrangement((prev) => addSectionStore(prev, startMs, endMs));
  }, []);
  const renameSection = useCallback((id: string, name: string) => {
    setArrangement((prev) => renameSectionStore(prev, id, name));
  }, []);
  const moveSection = useCallback((id: string, startMs: number) => {
    setArrangement((prev) => moveSectionStore(prev, id, startMs));
  }, []);
  const resizeSection = useCallback((id: string, endMs: number) => {
    setArrangement((prev) => resizeSectionStore(prev, id, endMs));
  }, []);
  const removeSection = useCallback((id: string) => {
    setArrangement((prev) => removeSectionStore(prev, id));
  }, []);
  const applyTemplate = useCallback((key: string, totalMs: number) => {
    setArrangement((prev) => applyTemplateStore(prev, key, totalMs));
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
    playGenRef.current++; // invalidate any in-flight voice-buffer decodes from this run
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
   * Flatten the arrangement and start playback via playArrangement, honouring the seek
   * position and (if armed) the loop region. Guard: no-op if already playing.
   *
   * The symbolic stream is shaped by the pure `buildPlaybackStream` (seek-shift / loop-window
   * with per-cycle force-close). Voice (audio) clips ride a parallel wall-clock path mapped
   * through the same transform: a clip is scheduled for each play whose START lands at/after
   * the seek (no loop) or inside the region (loop). Clips that would begin mid-window are
   * skipped — a documented V1 limitation (no partial-buffer offset), see ADR-0009.
   */
  const play = useCallback(
    (recordings: Recording[]) => {
      if (playerRef.current && !playerRef.current.stopped) return;

      const flat = flattenArrangement(arrangement, recordings);
      const useLoop = loopEnabled && loopRegion != null && loopRegion.endMs - loopRegion.startMs > 0;
      const loopLen = useLoop ? loopRegion!.endMs - loopRegion!.startMs : 0;
      const origin = useLoop ? loopRegion!.startMs : Math.max(0, seekMs);
      // Repeat enough to feel endless (~10 min) without an unbounded stream; capped so a tiny
      // region can't explode the event count.
      const cycles = useLoop ? Math.min(2000, Math.max(1, Math.ceil(600_000 / loopLen))) : 0;

      const stream = useLoop
        ? buildPlaybackStream(flat, { loop: { startMs: loopRegion!.startMs, endMs: loopRegion!.endMs, cycles } })
        : buildPlaybackStream(flat, { seekMs: origin });

      const player = playArrangement(stream, emit);
      playerRef.current = player;
      const gen = ++playGenRef.current; // this run's generation — pins async decodes to it
      setIsPlaying(true);
      setPlayStartedAt(performance.now());
      setPlayOriginMs(origin);
      setPlayLoopLenMs(loopLen);

      const fireVoice = (vp: { blobKey: string; effect: VoiceEffect }, at: number) => {
        const timer = setTimeout(() => {
          void loadVoiceBuffer(vp.blobKey).then((buf) => {
            if (!buf || playGenRef.current !== gen) return; // stopped / superseded before the decode landed
            voiceHandlesRef.current.push(playVoice(buf, vp.effect));
          });
        }, at);
        voiceTimersRef.current.push(timer);
      };

      let endMs = stream.length > 0 ? stream[stream.length - 1].t : 0;
      for (const vp of voiceClipPlays(arrangement, recordings)) {
        for (let k = 0; k < vp.loopCount; k++) {
          const playStart = vp.startMs + k * vp.durationMs;
          if (useLoop) {
            if (playStart >= loopRegion!.startMs && playStart < loopRegion!.endMs) {
              const rel = playStart - loopRegion!.startMs;
              for (let c = 0; c < cycles; c++) {
                const at = rel + c * loopLen;
                endMs = Math.max(endMs, at + vp.durationMs);
                fireVoice(vp, at);
              }
            }
          } else if (playStart >= origin) {
            const at = playStart - origin;
            endMs = Math.max(endMs, at + vp.durationMs);
            fireVoice(vp, at);
          }
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
    [arrangement, seekMs, loopRegion, loopEnabled, stopVoiceClips],
  );

  /** Stop playback and release held notes (no stuck note guarantee). */
  const stop = useCallback(() => {
    stopInternal();
  }, [stopInternal]);

  // --- Seek + loop-region (Slice 7b) ---------------------------------------------------------
  /** Move the play-from position (click-to-seek on the ruler). Clamped >= 0. */
  const seekTo = useCallback((ms: number) => setSeekMsState(Math.max(0, ms)), []);
  /**
   * Set (or clear) the loop region. Setting a valid region also arms the loop (drag-to-cycle,
   * like a DAW's cycle bar); a region with no positive span clears + disarms it.
   */
  const setLoopRegion = useCallback((region: { startMs: number; endMs: number } | null) => {
    if (!region || region.endMs - region.startMs <= 0) {
      setLoopRegionState(null);
      setLoopEnabled(false);
      return;
    }
    setLoopRegionState({ startMs: Math.max(0, region.startMs), endMs: Math.max(0, region.endMs) });
    setLoopEnabled(true);
  }, []);
  /** Arm/disarm the loop (transport 🔁). */
  const toggleLoop = useCallback(() => setLoopEnabled((v) => !v), []);

  /** Preview a single saved recording (shelf ▶); clicking the playing one stops it. */
  const previewRecording = useCallback(
    (rec: Recording) => {
      // Also treat an in-flight decode of THIS take as "playing" (previewIntentRef === rec.id):
      // for a voice take voicePreviewRef stays null until the async decode resolves, so without
      // this a re-click during decode would start a SECOND decode and orphan the first handle.
      const playingThis =
        previewingId === rec.id &&
        (previewRef.current || voicePreviewRef.current || previewIntentRef.current === rec.id);
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

  /** Add an imported song (already remapped to fresh ids) to the library and switch to it. */
  const importSong = useCallback(
    (song: Arrangement) => {
      stopInternal();
      stopPreview();
      setSongs((prev) => [...prev, song]);
      setActiveSongId(song.id);
    },
    [stopInternal, stopPreview],
  );

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
    stopPreview,
    play,
    stop,
  };
}
