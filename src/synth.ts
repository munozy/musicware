import { invoke } from "@tauri-apps/api/core";

/**
 * The single choke point for every sound the UI triggers. Both the on-screen
 * keyboard and the preset selector dispatch through here instead of calling
 * `invoke` directly, which gives the recorder ONE place to tap the live event
 * stream — the Rust audio engine never has to know recording exists.
 */
export type SynthEvent =
  | { kind: "on"; note: number }
  | { kind: "off"; note: number }
  | { kind: "preset"; index: number };

// Optional sink the recorder installs while armed. Null when not recording.
let sink: ((e: SynthEvent) => void) | null = null;

/** Install (or clear, with null) the recording tap. */
export function setSynthSink(s: ((e: SynthEvent) => void) | null): void {
  sink = s;
}

// Last preset sent to the engine — the engine boots on preset 0 (Sine), so do we.
// The recorder reads this to stamp the active timbre at the start of a take.
let currentPreset = 0;
export function getCurrentPreset(): number {
  return currentPreset;
}

/**
 * Note-event broadcast. Every note that actually reaches the engine — whether
 * played live or re-dispatched by replay — is announced here, so the keyboard can
 * light up the keys being played, in sync, from a single source of truth.
 */
export type NoteSignal = { kind: "on" | "off"; note: number };
const noteListeners = new Set<(e: NoteSignal) => void>();

/** Subscribe to note on/off as they hit the engine. Returns an unsubscribe fn. */
export function subscribeNotes(fn: (e: NoteSignal) => void): () => void {
  noteListeners.add(fn);
  return () => {
    noteListeners.delete(fn);
  };
}

function announce(e: NoteSignal): void {
  for (const fn of noteListeners) fn(e);
}

/**
 * Preset-change broadcast. Fires whenever the active preset reaches the engine —
 * live click OR replay — so the preset selector can reflect what's actually
 * sounding (e.g. re-highlight the timbre a take was recorded with during replay).
 */
const presetListeners = new Set<(index: number) => void>();

export function subscribePreset(fn: (index: number) => void): () => void {
  presetListeners.add(fn);
  return () => {
    presetListeners.delete(fn);
  };
}

/**
 * Dispatch one event to the engine WITHOUT tapping the recorder — used by replay
 * so playing a take never records itself. `kind` maps 1:1 to a Tauri command.
 */
export function emit(e: SynthEvent): void {
  switch (e.kind) {
    case "on":
      invoke("note_on", { note: e.note }).catch((err) => console.error("note_on failed", err));
      announce({ kind: "on", note: e.note });
      break;
    case "off":
      invoke("note_off", { note: e.note }).catch((err) => console.error("note_off failed", err));
      announce({ kind: "off", note: e.note });
      break;
    case "preset":
      currentPreset = e.index;
      invoke("set_preset", { index: e.index }).catch((err) => console.error("set_preset failed", err));
      for (const fn of presetListeners) fn(e.index);
      break;
  }
}

// Live UI helpers: tap the recorder (if armed) THEN dispatch to the engine.
export function noteOn(note: number): void {
  sink?.({ kind: "on", note });
  emit({ kind: "on", note });
}

export function noteOff(note: number): void {
  sink?.({ kind: "off", note });
  emit({ kind: "off", note });
}

export function setPreset(index: number): void {
  sink?.({ kind: "preset", index });
  emit({ kind: "preset", index });
}

/**
 * Set the master volume level (0..1). This is a monitor/output setting, not
 * musical content, so it is NOT tapped by the recorder or echoed to keyboard
 * highlights — it just reaches the engine.
 */
export function setVolume(level: number): void {
  invoke("set_volume", { level }).catch((err) => console.error("set_volume failed", err));
}
