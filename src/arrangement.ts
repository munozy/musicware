import { isVoice, type Recording, type RecEvent, type VoiceEffect } from "./recordings";
import type { SynthEvent } from "./synth";

/**
 * KA-1 — the multi-clip arrangement SCHEDULER (the feasibility gate for PRD-004 /
 * ADR-0007). It is a *pure*, frontend-only generalisation of the recorder's replay
 * (ADR-0002): given an Arrangement (tracks of clip instances referencing Recordings),
 * it flattens every active clip into ONE time-ordered event stream, then a tiny player
 * dispatches that stream into the engine through the SAME `emit()` choke point as live
 * play. The engine never learns arrangement exists.
 *
 * The dominant risk this module exists to retire: overlapping clips + a mid-stream Stop
 * must NEVER strand a held note (a `note_on` with no matching `note_off`). Two mechanisms
 * guarantee it, both tested below:
 *   1. every loop window self-closes — notes still held at a window's end are force-released,
 *      so loops can't stack/bleed and a held-at-end recording can't leak;
 *   2. the player tracks what is currently sounding and releases all of it on `stop()`.
 *
 * Field names are canonical per CONTRACT.md / ADR-0007: `startMs`, `transpose`,
 * `loopCount`, `trimStartMs`, `trimEndMs`. Positions are absolute ms (no bar-rescaling in V1).
 */

export type ClipInstance = {
  id: string;
  recordingId: string;
  startMs: number;
  transpose: number;
  loopCount: number;
  trimStartMs?: number | null;
  trimEndMs?: number | null;
  /** Per-clip mute — a muted clip is skipped by the scheduler (independent of track mute). */
  muted?: boolean;
  /** VOICE clips only: per-instance effect override. Falls back to the take's effect when
   * unset, so the same voice take can sound different in different spots (ADR-0009). */
  effect?: VoiceEffect;
};

export type Track = {
  id: string;
  name: string;
  color: string;
  presetIndex: number;
  clips: ClipInstance[];
  muted: boolean;
  soloed: boolean;
};

export type Section = {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  color: string;
};

export type Arrangement = {
  id: string;
  name: string;
  createdAt: number;
  tempoBpm: number;
  timeSig: [number, number];
  tracks: Track[];
  sections: Section[];
};

/** A SynthEvent stamped with its ABSOLUTE position on the arrangement timeline (ms). */
export type ScheduledEvent = SynthEvent & { t: number };

const MIN_NOTE = 0;
const MAX_NOTE = 127;
const clampNote = (n: number): number => Math.max(MIN_NOTE, Math.min(MAX_NOTE, Math.round(n)));

function toMap(recordings: Recording[] | Map<string, Recording>): Map<string, Recording> {
  if (recordings instanceof Map) return recordings;
  const m = new Map<string, Recording>();
  for (const r of recordings) m.set(r.id, r);
  return m;
}

/**
 * The trim window of ONE loop iteration, clamped to the recording's real duration.
 * `trimStartMs`/`trimEndMs` are nullable (untrimmed ⇒ the full `[0, durationMs]`). Shared
 * by the scheduler (`flattenClip`) and the UI (clip-block width) so the picture on the
 * timeline always matches what actually plays.
 */
export function clipWindow(
  clip: Pick<ClipInstance, "trimStartMs" | "trimEndMs">,
  durationMs: number,
): { ws: number; we: number; windowLen: number } {
  const dur = Math.max(0, durationMs);
  const ws = Math.max(0, Math.min(clip.trimStartMs ?? 0, dur));
  const we = Math.max(ws, Math.min(clip.trimEndMs ?? dur, dur));
  return { ws, we, windowLen: we - ws };
}

/** Total played length = trimmed window × loopCount (ms). Drives the clip-block width. */
export function clipPlayedMs(
  clip: Pick<ClipInstance, "trimStartMs" | "trimEndMs" | "loopCount">,
  durationMs: number,
): number {
  const loops = Math.max(1, Math.floor(clip.loopCount || 1));
  return clipWindow(clip, durationMs).windowLen * loops;
}

/** The end time of the latest-finishing clip (ms) — the arrangement's content length; 0 if empty.
 * Used to size song-structure templates (Slice 6) to the actual material. */
export function arrangementContentMs(
  arr: Arrangement,
  recordings: Recording[] | Map<string, Recording>,
): number {
  const byId = toMap(recordings);
  let end = 0;
  for (const track of arr.tracks) {
    for (const clip of track.clips) {
      const rec = byId.get(clip.recordingId);
      if (!rec) continue;
      end = Math.max(end, Math.max(0, clip.startMs) + clipPlayedMs(clip, rec.durationMs));
    }
  }
  return end;
}

/**
 * Expand a single clip instance into absolute-timed events. Pure; never throws on a
 * dangling/degenerate clip (returns []). Each loop iteration force-closes notes still
 * held at the window end — that is the per-clip half of the no-stranded-note guarantee.
 */
function flattenClip(clip: ClipInstance, rec: Recording): ScheduledEvent[] {
  const dur = Math.max(0, rec.durationMs);
  const { ws, we, windowLen } = clipWindow(clip, dur);
  if (windowLen <= 0) return []; // degenerate trim window — nothing to play

  const loopCount = Math.max(1, Math.floor(clip.loopCount || 1));
  const startMs = Math.max(0, clip.startMs);
  const transpose = Math.trunc(clip.transpose || 0);

  // Source events inside the trim window, defensively sorted by t.
  const windowEvents = [...rec.events]
    .filter((e) => e.t >= ws && e.t < we)
    .sort((a, b) => a.t - b.t);

  // The clip's instrument at entry: the most recent preset stamped at/before the window
  // start (ws). For an untrimmed clip ws=0, so this is the recording's t=0 stamp (every real
  // recording seeds one — useRecorder.ts). null only for the synthetic, preset-less
  // recordings used in tests; those keep the old "emit no preset" behaviour.
  let entryPreset: number | null = null;
  {
    let bestT = -1;
    for (const e of rec.events) {
      if (e.kind === "preset" && e.t <= ws && e.t >= bestT) {
        bestT = e.t;
        entryPreset = e.index;
      }
    }
  }

  const out: ScheduledEvent[] = [];
  for (let k = 0; k < loopCount; k++) {
    // Loops advance by the (trimmed) window length, NOT durationMs — so trimmed loops abut
    // instead of overlapping (ADR-0007: windowLen == durationMs when the clip is untrimmed).
    const loopBase = startMs + k * windowLen;
    let curPreset = entryPreset; // this clip's active instrument, tracked across in-take changes
    const active = new Set<number>(); // notes turned on INSIDE this window, not yet off
    for (const e of windowEvents) {
      const at = loopBase + (e.t - ws);
      if (e.kind === "on") {
        const note = clampNote(e.note + transpose);
        // A clamp collision or a faithless double-on becomes a clean retrigger.
        if (active.has(note)) out.push({ t: at, kind: "off", note });
        // Re-assert THIS clip's instrument immediately before EVERY note. The engine captures
        // the GLOBAL preset at note-on (ADR-0008); an interleaved clip's note overwrites that
        // global, so without re-stamping, a brick's later notes adopt the OTHER brick's timbre
        // (a drum brick turns piano when a piano brick starts). Stamping the clip's own preset
        // right before each note keeps a brick atomic, whatever else is playing at the time.
        if (curPreset !== null) out.push({ t: at, kind: "preset", index: curPreset });
        out.push({ t: at, kind: "on", note });
        active.add(note);
      } else if (e.kind === "off") {
        const note = clampNote(e.note + transpose);
        // Release ONLY a note this window actually opened. A bare `off` whose `on` was
        // trimmed away is SUPPRESSED: the engine's note_off(n) releases every voice of
        // pitch n, so a dangling off would cut a same-pitch note held by another clip.
        if (active.has(note)) {
          out.push({ t: at, kind: "off", note });
          active.delete(note);
        }
      } else {
        // A preset change inside the take: fold it into the per-note re-assert above rather
        // than emitting it standalone — a preset with no following note is inaudible (the
        // engine only reads the global at note-on), and a standalone would just duplicate it.
        curPreset = e.index;
      }
    }
    // Self-close: release anything THIS window opened and left held (no bleed/leak).
    if (active.size > 0) {
      const closeAt = loopBase + windowLen;
      for (const note of active) out.push({ t: closeAt, kind: "off", note });
    }
  }
  return out;
}

/**
 * Flatten a whole arrangement into one time-ordered event stream.
 * Solo wins over mute: if ANY track is soloed, only soloed tracks play; otherwise every
 * non-muted track plays. Dangling clips (missing Recording) are skipped, never thrown on.
 *
 * KNOWN V1 LIMITATION (documented, deferred — see ADR-0007 + DEBT-027): two clips sounding
 * the SAME pitch at overlapping times collapse to the earliest release, because the engine's
 * note_off(n) releases every voice of pitch n (it has no per-voice id). So the later note is
 * cut when the earlier one ends. This is the same family as ADR-0007's accepted per-track-
 * instrument overlap limitation; coalescing same-pitch overlaps is a later refinement, not a
 * V1 prerequisite. (Differing pitches across tracks overlap correctly — the common case.)
 */
export function flattenArrangement(
  arr: Arrangement,
  recordings: Recording[] | Map<string, Recording>,
): ScheduledEvent[] {
  const byId = toMap(recordings);
  const anySolo = arr.tracks.some((t) => t.soloed);

  const events: ScheduledEvent[] = [];
  for (const track of arr.tracks) {
    const audible = anySolo ? track.soloed : !track.muted;
    if (!audible) continue;
    for (const clip of track.clips) {
      if (clip.muted) continue; // per-clip mute — skip this brick
      const rec = byId.get(clip.recordingId);
      if (!rec) continue; // dangling reference — skip safely
      events.push(...flattenClip(clip, rec));
    }
  }

  // STABLE sort by time only. Crucially this keeps each clip's events grouped at a shared
  // instant (flattenClip already emits preset-before-its-notes, and clips are pushed in
  // order), so every note_on stays immediately after ITS OWN clip's set_preset. The engine
  // captures the preset at note-on (ADR-0008), so this is what makes two clips that start at
  // the SAME time each keep their own instrument — a global kind-sort grouped all presets
  // first, making both notes capture whichever preset fired last (the overlap bug).
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** A voice clip to schedule for audio playback alongside the symbolic stream (ADR-0009). */
export type VoiceClipPlay = {
  recordingId: string;
  blobKey: string;
  effect: VoiceEffect;
  startMs: number;
  loopCount: number;
  durationMs: number;
};

/**
 * The voice (audio) clips an arrangement should play, with the SAME mute/solo gating as
 * `flattenArrangement` (solo wins over mute; per-clip mute and dangling refs skipped).
 * Voice clips carry no symbolic events, so `flattenArrangement` naturally ignores them —
 * this is the parallel audio pass the Player schedules through Web Audio (voiceAudio.ts).
 */
export function voiceClipPlays(
  arr: Arrangement,
  recordings: Recording[] | Map<string, Recording>,
): VoiceClipPlay[] {
  const byId = toMap(recordings);
  const anySolo = arr.tracks.some((t) => t.soloed);
  const plays: VoiceClipPlay[] = [];
  for (const track of arr.tracks) {
    const audible = anySolo ? track.soloed : !track.muted;
    if (!audible) continue;
    for (const clip of track.clips) {
      if (clip.muted) continue;
      const rec = byId.get(clip.recordingId);
      if (!rec || !isVoice(rec) || !rec.audio) continue;
      plays.push({
        recordingId: rec.id,
        blobKey: rec.audio.blobKey,
        effect: clip.effect ?? rec.audio.effect, // per-clip override wins; else the take's effect
        startMs: Math.max(0, clip.startMs),
        loopCount: Math.max(1, Math.floor(clip.loopCount || 1)),
        durationMs: Math.max(0, rec.durationMs),
      });
    }
  }
  return plays;
}

/**
 * The notes left sounding after dispatching every event up to and including `untilT`
 * (default: the whole stream). A correct, fully-played stream returns an empty set —
 * that is the no-stranded-note invariant. Used by the player for safe Stop and by tests.
 */
export function pendingNotesAfter(events: ScheduledEvent[], untilT = Infinity): Set<number> {
  const sounding = new Set<number>();
  for (const e of events) {
    if (e.t > untilT) break; // events are sorted; the rest are in the future
    if (e.kind === "on") sounding.add(e.note);
    else if (e.kind === "off") sounding.delete(e.note);
  }
  return sounding;
}

export type Emit = (e: SynthEvent) => void;
export type Player = { stop: () => void; readonly stopped: boolean };

type Timers = {
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

const defaultTimers: Timers = {
  setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimer: (id) => clearTimeout(id),
};

/**
 * Dispatch a flattened stream into `emit` on a wall-clock schedule, returning a handle
 * whose `stop()` cancels every pending event AND releases every note still sounding —
 * so stopping mid-arrangement can never leave a stuck note. Timer fns are injectable for
 * deterministic tests (vitest fake timers patch the globals, so the defaults also work).
 */
export function playArrangement(events: ScheduledEvent[], emit: Emit, timers: Timers = defaultTimers): Player {
  const sounding = new Set<number>();
  const pending: number[] = [];
  let stopped = false;

  const fire = (e: ScheduledEvent): void => {
    if (stopped) return;
    if (e.kind === "on") sounding.add(e.note);
    else if (e.kind === "off") sounding.delete(e.note);
    emit(e);
  };

  for (const e of events) {
    pending.push(timers.setTimer(() => fire(e), Math.max(0, e.t)));
  }

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const id of pending) timers.clearTimer(id);
    pending.length = 0;
    // Release everything still held, then forget it (idempotent: a second stop is a no-op).
    for (const note of sounding) emit({ kind: "off", note });
    sounding.clear();
  };

  return {
    stop,
    get stopped() {
      return stopped;
    },
  };
}

/** Re-export for callers building clips from takes. */
export type { Recording, RecEvent };
