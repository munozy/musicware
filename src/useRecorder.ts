import { useCallback, useEffect, useRef, useState } from "react";
import { emit, getCurrentPreset, setSynthSink, type SynthEvent } from "./synth";
import {
  loadRecordings,
  newId,
  nextName,
  saveRecordings,
  type RecEvent,
  type Recording,
} from "./recordings";

/** How long a deleted take can be undone before the removal is final. */
export const UNDO_MS = 5000;

/** A take just removed, held briefly so the deletion can be undone. */
export type PendingDelete = { recording: Recording; index: number };

/**
 * Recording / playback engine for keyboard compositions. Capture taps the live
 * synth event stream (note on/off + preset) with millisecond timestamps; playback
 * re-dispatches that stream to the engine on a schedule. Everything is in-memory +
 * localStorage — the Rust audio path is untouched.
 */
export function useRecorder() {
  const [recordings, setRecordings] = useState<Recording[]>(() => loadRecordings());
  const [isRecording, setIsRecording] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // The most recent delete, kept for a short undo window (null = nothing to undo).
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recording scratch state.
  const t0Ref = useRef(0);
  const bufferRef = useRef<RecEvent[]>([]);
  const recNotesRef = useRef<Set<number>>(new Set()); // notes on, awaiting their off
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Playback scratch state.
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playNotesRef = useRef<Set<number>>(new Set()); // notes sounding mid-playback

  // Persist whenever the library changes.
  useEffect(() => {
    saveRecordings(recordings);
  }, [recordings]);

  const clearPlayback = useCallback(() => {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
    // Release anything still sounding so a stopped playback never strands a note.
    for (const note of playNotesRef.current) emit({ kind: "off", note });
    playNotesRef.current.clear();
  }, []);

  const stopPlayback = useCallback(() => {
    clearPlayback();
    setPlayingId(null);
  }, [clearPlayback]);

  const startRecording = useCallback(() => {
    if (isRecording) return;
    stopPlayback();
    t0Ref.current = performance.now();
    recNotesRef.current = new Set();
    // Stamp the active timbre at t=0 so a take always replays with the right sound.
    bufferRef.current = [{ t: 0, kind: "preset", index: getCurrentPreset() }];
    setSynthSink((e: SynthEvent) => {
      const t = performance.now() - t0Ref.current;
      bufferRef.current.push({ t, ...e });
      if (e.kind === "on") recNotesRef.current.add(e.note);
      else if (e.kind === "off") recNotesRef.current.delete(e.note);
    });
    setIsRecording(true);
    setElapsedMs(0);
    tickRef.current = setInterval(() => setElapsedMs(performance.now() - t0Ref.current), 200);
  }, [isRecording, stopPlayback]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    setSynthSink(null);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    const durationMs = performance.now() - t0Ref.current;
    // Close any note still held at stop so the take is self-contained.
    for (const note of recNotesRef.current) {
      bufferRef.current.push({ t: durationMs, kind: "off", note });
    }
    recNotesRef.current.clear();
    const events = bufferRef.current;
    bufferRef.current = [];
    setIsRecording(false);
    setElapsedMs(0);
    // A take with no real notes (only the t=0 preset stamp) isn't worth keeping.
    if (events.filter((e) => e.kind === "on").length === 0) return;
    setRecordings((list) => [
      ...list,
      { id: newId(), name: nextName(list), createdAt: Date.now(), durationMs, events },
    ]);
  }, [isRecording]);

  const play = useCallback(
    (id: string) => {
      if (isRecording) return;
      clearPlayback();
      const rec = recordings.find((r) => r.id === id);
      if (!rec) return;
      setPlayingId(id);
      for (const ev of rec.events) {
        const handle = setTimeout(() => {
          emit(ev);
          if (ev.kind === "on") playNotesRef.current.add(ev.note);
          else if (ev.kind === "off") playNotesRef.current.delete(ev.note);
        }, ev.t);
        timeoutsRef.current.push(handle);
      }
      // Drop the playing flag just after the final event.
      const end = setTimeout(() => {
        timeoutsRef.current = [];
        playNotesRef.current.clear();
        setPlayingId(null);
      }, rec.durationMs + 1);
      timeoutsRef.current.push(end);
    },
    [isRecording, recordings, clearPlayback],
  );

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setRecordings((list) => list.map((r) => (r.id === id ? { ...r, name: trimmed } : r)));
  }, []);

  // Soft delete: drop the take from the list (and storage) immediately, but stash
  // it for UNDO_MS so a misclick is recoverable. Only one undo slot — a second
  // delete finalizes the previous one (it stays removed).
  const remove = useCallback(
    (id: string) => {
      const index = recordings.findIndex((r) => r.id === id);
      if (index === -1) return;
      const recording = recordings[index];
      if (playingId === id) stopPlayback();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setPendingDelete({ recording, index });
      setRecordings((list) => list.filter((r) => r.id !== id));
      undoTimerRef.current = setTimeout(() => {
        setPendingDelete(null);
        undoTimerRef.current = null;
      }, UNDO_MS);
    },
    [recordings, playingId, stopPlayback],
  );

  const undoDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const { recording, index } = pendingDelete;
    setRecordings((list) => {
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, recording); // restore at its old spot
      return next;
    });
    setPendingDelete(null);
  }, [pendingDelete]);

  // Clean up on unmount. clearPlayback (not a bare clearTimeout loop) so any notes
  // still sounding from an in-flight replay are released — otherwise unmounting
  // mid-playback (HMR, future in-app nav) strands voices in the audio engine.
  useEffect(() => {
    return () => {
      clearPlayback();
      if (tickRef.current) clearInterval(tickRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setSynthSink(null);
    };
  }, [clearPlayback]);

  return {
    recordings,
    isRecording,
    playingId,
    elapsedMs,
    pendingDelete,
    startRecording,
    stopRecording,
    play,
    stopPlayback,
    rename,
    remove,
    undoDelete,
  };
}
