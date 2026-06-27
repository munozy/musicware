import type { Recording, RecEvent } from "./recordings";
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

// Equal-t ordering: a preset takes effect, then releases happen, then presses — so a
// retrigger at the same instant reads as off-then-on rather than a doubled voice.
const KIND_ORDER: Record<SynthEvent["kind"], number> = { preset: 0, off: 1, on: 2 };

function toMap(recordings: Recording[] | Map<string, Recording>): Map<string, Recording> {
  if (recordings instanceof Map) return recordings;
  const m = new Map<string, Recording>();
  for (const r of recordings) m.set(r.id, r);
  return m;
}

/**
 * Expand a single clip instance into absolute-timed events. Pure; never throws on a
 * dangling/degenerate clip (returns []). Each loop iteration force-closes notes still
 * held at the window end — that is the per-clip half of the no-stranded-note guarantee.
 */
function flattenClip(clip: ClipInstance, rec: Recording): ScheduledEvent[] {
  const dur = Math.max(0, rec.durationMs);
  const ws = Math.max(0, Math.min(clip.trimStartMs ?? 0, dur));
  const we = Math.max(ws, Math.min(clip.trimEndMs ?? dur, dur));
  const windowLen = we - ws;
  if (windowLen <= 0) return []; // degenerate trim window — nothing to play

  const loopCount = Math.max(1, Math.floor(clip.loopCount || 1));
  const startMs = Math.max(0, clip.startMs);
  const transpose = Math.trunc(clip.transpose || 0);

  // Source events inside the trim window, defensively sorted by t.
  const windowEvents = [...rec.events]
    .filter((e) => e.t >= ws && e.t < we)
    .sort((a, b) => a.t - b.t);

  // When the window starts mid-recording, the clip's own preset stamp (usually at t=0) is
  // filtered out. Carry the most recent preset at/before ws forward so the clip still
  // announces its timbre when it ENTERS ("last preset wins" — ADR-0007). Re-stamped each
  // loop iteration so interleaving with other clips can't strand it on a stale timbre.
  let carriedPreset: number | null = null;
  if (ws > 0) {
    let bestT = -1;
    for (const e of rec.events) {
      if (e.kind === "preset" && e.t <= ws && e.t >= bestT) {
        bestT = e.t;
        carriedPreset = e.index;
      }
    }
  }

  const out: ScheduledEvent[] = [];
  for (let k = 0; k < loopCount; k++) {
    // Loops advance by the (trimmed) window length, NOT durationMs — so trimmed loops abut
    // instead of overlapping (ADR-0007: windowLen == durationMs when the clip is untrimmed).
    const loopBase = startMs + k * windowLen;
    if (carriedPreset !== null) out.push({ t: loopBase, kind: "preset", index: carriedPreset });
    const active = new Set<number>(); // notes turned on INSIDE this window, not yet off
    for (const e of windowEvents) {
      const at = loopBase + (e.t - ws);
      if (e.kind === "on") {
        const note = clampNote(e.note + transpose);
        // A clamp collision or a faithless double-on becomes a clean retrigger.
        if (active.has(note)) out.push({ t: at, kind: "off", note });
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
        out.push({ t: at, kind: "preset", index: e.index });
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

  events.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return events;
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
