/**
 * Pure load/save/new helpers for the Arrangement — mirrors recordings.ts patterns.
 * localStorage key: `musicware.arrangements.v1`.
 * All functions tolerate missing/corrupt storage by returning a fresh default.
 */

import type { Arrangement, Track, ClipInstance, Section } from "./arrangement";
import { newId, type VoiceEffect } from "./recordings";

const STORAGE_KEY = "musicware.arrangements.v1";

// Distinct lane colours so tracks read as separate places to stack bricks (the
// building-block recombination the workspace exists for). Exported so the UI can cycle.
export const TRACK_PALETTE = ["#7c5cff", "#1fa8a0", "#e06a8b", "#f5a623", "#4f86f7", "#46c66d"];

function makeDefaultTrack(n: number, color: string): Track {
  return {
    id: newId(),
    name: `Track ${n}`,
    color,
    presetIndex: 0,
    clips: [],
    muted: false,
    soloed: false,
  };
}

/** Create a fresh arrangement with three default tracks (so clips can be layered across lanes). */
export function newArrangement(): Arrangement {
  return {
    id: newId(),
    name: "Untitled",
    createdAt: Date.now(),
    tempoBpm: 120,
    timeSig: [4, 4],
    tracks: TRACK_PALETTE.slice(0, 3).map((c, i) => makeDefaultTrack(i + 1, c)),
    sections: [],
  };
}

/** Read the arrangement from localStorage. Returns a fresh default on missing/corrupt data. */
export function loadArrangement(): Arrangement {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return newArrangement();
    const parsed = JSON.parse(raw);
    // Guard the shape: a malformed/old-schema object without a tracks array would
    // crash downstream (arrangement.tracks.map). Fall back to a fresh default.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.tracks)) {
      return newArrangement();
    }
    return parsed as Arrangement;
  } catch {
    return newArrangement();
  }
}

/** Persist the arrangement (try/catch mirrors saveRecordings). */
export function saveArrangement(a: Arrangement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch (e) {
    console.error("failed to persist arrangement", e);
  }
}

/**
 * Return a new arrangement with a fresh ClipInstance appended to the given track.
 * Pure/immutable — the input arrangement is never mutated.
 * If trackId doesn't exist the arrangement is returned unchanged (dangling-safe).
 */
export function addClip(
  arr: Arrangement,
  trackId: string,
  recordingId: string,
  startMs: number,
): Arrangement {
  const trackIndex = arr.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex === -1) return arr;

  const clip: ClipInstance = {
    id: newId(),
    recordingId,
    startMs,
    transpose: 0,
    loopCount: 1,
  };

  const updatedTrack: Track = {
    ...arr.tracks[trackIndex],
    clips: [...arr.tracks[trackIndex].clips, clip],
  };

  const updatedTracks = arr.tracks.map((t, i) => (i === trackIndex ? updatedTrack : t));

  return { ...arr, tracks: updatedTracks };
}

/** Two octaves either way — beyond that a transposed brick rarely stays musical, and the
 * engine clamps notes to [0,127] anyway (arrangement.ts clampNote). */
export const MAX_TRANSPOSE = 24;

/**
 * Replace the clip with `clipId` (wherever it lives) by `fn(clip)`, immutably. Returns the
 * SAME arrangement reference if no clip matches — so callers can rely on identity for
 * "nothing changed". The shared spine of every per-clip mutator below.
 */
function mapMatchingClip(
  arr: Arrangement,
  clipId: string,
  fn: (clip: ClipInstance) => ClipInstance,
): Arrangement {
  let found = false;
  const tracks = arr.tracks.map((t) => {
    if (!t.clips.some((c) => c.id === clipId)) return t;
    found = true;
    return { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) };
  });
  return found ? { ...arr, tracks } : arr;
}

/**
 * Return a new arrangement with the given clip moved to `startMs` (clamped >= 0).
 * Pure/immutable; finds the clip across all tracks. Time-only — the clip stays on
 * its track (cross-track move is a later slice). Unknown clipId → unchanged.
 */
export function moveClip(arr: Arrangement, clipId: string, startMs: number): Arrangement {
  const at = Math.max(0, Math.round(startMs));
  return mapMatchingClip(arr, clipId, (c) => ({ ...c, startMs: at }));
}

/**
 * Duplicate a placed clip (US-13, the core "LEGO" recombination edit): a copy with a fresh
 * id and all edits preserved (transpose/loop/trim/mute), inserted right after the original
 * on the SAME track at `atMs` (clamped >= 0; the caller passes startMs + the clip's played
 * length so the copy abuts). Pure/immutable; unknown clipId → unchanged.
 */
export function duplicateClip(arr: Arrangement, clipId: string, atMs: number): Arrangement {
  const at = Math.max(0, Math.round(atMs));
  let found = false;
  const tracks = arr.tracks.map((t) => {
    const idx = t.clips.findIndex((c) => c.id === clipId);
    if (idx === -1) return t;
    found = true;
    const copy: ClipInstance = { ...t.clips[idx], id: newId(), startMs: at };
    const clips = [...t.clips];
    clips.splice(idx + 1, 0, copy);
    return { ...t, clips };
  });
  return found ? { ...arr, tracks } : arr;
}

/** Set a clip's loop count (US-15). Clamped to a whole number >= 1. Unknown clipId → unchanged. */
export function setClipLoopCount(arr: Arrangement, clipId: string, count: number): Arrangement {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  return mapMatchingClip(arr, clipId, (c) => ({ ...c, loopCount: n }));
}

/** Set a clip's transpose in semitones (US-16). Clamped to ±MAX_TRANSPOSE. Unknown clipId → unchanged. */
export function setClipTranspose(arr: Arrangement, clipId: string, semitones: number): Arrangement {
  const t = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, Math.trunc(Number.isFinite(semitones) ? semitones : 0)));
  return mapMatchingClip(arr, clipId, (c) => ({ ...c, transpose: t }));
}

/** Set a VOICE clip's per-instance effect override (ADR-0009). Unknown clipId → unchanged. */
export function setClipEffect(arr: Arrangement, clipId: string, effect: VoiceEffect): Arrangement {
  return mapMatchingClip(arr, clipId, (c) => ({ ...c, effect }));
}

/**
 * Set a clip's trim window (US-17), and optionally its startMs (a left-edge trim shifts the
 * block so the kept content stays put). Each provided field is rounded and clamped >= 0; the
 * CALLER owns duration-aware bounds (it has the recording length) and the min-window guard.
 * Unknown clipId → unchanged.
 */
export function setClipTrim(
  arr: Arrangement,
  clipId: string,
  patch: { startMs?: number; trimStartMs?: number; trimEndMs?: number },
): Arrangement {
  const round0 = (n: number) => Math.max(0, Math.round(n));
  return mapMatchingClip(arr, clipId, (c) => ({
    ...c,
    ...(patch.startMs != null ? { startMs: round0(patch.startMs) } : {}),
    ...(patch.trimStartMs != null ? { trimStartMs: round0(patch.trimStartMs) } : {}),
    ...(patch.trimEndMs != null ? { trimEndMs: round0(patch.trimEndMs) } : {}),
  }));
}

// ---- Track management (Slice 3, US-3/4/5/6/10) — all pure/immutable, unknown-id safe ----

/** Append a new empty track (next palette colour, next number). */
export function addTrack(arr: Arrangement): Arrangement {
  const n = arr.tracks.length;
  const color = TRACK_PALETTE[n % TRACK_PALETTE.length];
  return { ...arr, tracks: [...arr.tracks, makeDefaultTrack(n + 1, color)] };
}

/** Rename a track. Empty/whitespace names and unknown ids are ignored (unchanged). */
export function renameTrack(arr: Arrangement, trackId: string, name: string): Arrangement {
  const trimmed = name.trim();
  if (!trimmed || !arr.tracks.some((t) => t.id === trackId)) return arr;
  return { ...arr, tracks: arr.tracks.map((t) => (t.id === trackId ? { ...t, name: trimmed } : t)) };
}

/** Set a track's colour. Unknown id → unchanged. */
export function setTrackColor(arr: Arrangement, trackId: string, color: string): Arrangement {
  if (!arr.tracks.some((t) => t.id === trackId)) return arr;
  return { ...arr, tracks: arr.tracks.map((t) => (t.id === trackId ? { ...t, color } : t)) };
}

/** Move a track one slot up/down. Clamped at the ends; unknown id → unchanged. */
export function reorderTrack(arr: Arrangement, trackId: string, dir: "up" | "down"): Arrangement {
  const i = arr.tracks.findIndex((t) => t.id === trackId);
  if (i === -1) return arr;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= arr.tracks.length) return arr;
  const tracks = [...arr.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...arr, tracks };
}

/** Remove a track and its clips. Refuses to remove the last track; unknown id → unchanged. */
export function removeTrack(arr: Arrangement, trackId: string): Arrangement {
  if (arr.tracks.length <= 1 || !arr.tracks.some((t) => t.id === trackId)) return arr;
  return { ...arr, tracks: arr.tracks.filter((t) => t.id !== trackId) };
}

/** Remove a placed clip from whatever track holds it. Pure/immutable; unknown id → unchanged. */
export function removeClip(arr: Arrangement, clipId: string): Arrangement {
  let found = false;
  const tracks = arr.tracks.map((t) => {
    if (!t.clips.some((c) => c.id === clipId)) return t;
    found = true;
    return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
  });
  return found ? { ...arr, tracks } : arr;
}

/** Toggle a track's mute (US-7). flattenArrangement already gates on it. Unknown id → unchanged. */
export function toggleTrackMuted(arr: Arrangement, trackId: string): Arrangement {
  if (!arr.tracks.some((t) => t.id === trackId)) return arr;
  return { ...arr, tracks: arr.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) };
}

/** Toggle a track's solo (US-8). flattenArrangement: any solo ⇒ only soloed tracks play. Unknown id → unchanged. */
export function toggleTrackSoloed(arr: Arrangement, trackId: string): Arrangement {
  if (!arr.tracks.some((t) => t.id === trackId)) return arr;
  return { ...arr, tracks: arr.tracks.map((t) => (t.id === trackId ? { ...t, soloed: !t.soloed } : t)) };
}

/** Toggle a single clip's mute (per-brick). flattenArrangement skips muted clips. Unknown id → unchanged. */
export function toggleClipMuted(arr: Arrangement, clipId: string): Arrangement {
  return mapMatchingClip(arr, clipId, (c) => ({ ...c, muted: !c.muted }));
}

// ---- Transport / grid: tempo + time signature (Slice 7, US-23/24) ----
// US-25 limitation (documented): changing tempo re-grids the ruler/snap but does NOT rescale
// already-placed clip startMs — clips stay at their absolute ms positions.

/** Set the tempo in BPM, clamped to a musical 40–300. */
export function setTempo(arr: Arrangement, bpm: number): Arrangement {
  const t = Math.max(40, Math.min(300, Math.round(Number.isFinite(bpm) ? bpm : 120)));
  return { ...arr, tempoBpm: t };
}

/** Set the beats-per-bar (time-sig numerator), clamped to 1–12; denominator stays 4. */
export function setBeatsPerBar(arr: Arrangement, beats: number): Arrangement {
  const n = Math.max(1, Math.min(12, Math.round(Number.isFinite(beats) ? beats : 4)));
  return { ...arr, timeSig: [n, arr.timeSig?.[1] ?? 4] };
}

// ---- Song structure: section markers + genre templates (Slice 6, US-20/21) ----
// Sections are VISUAL guides only — flattenArrangement never reads them (they don't gate playback).

export const SECTION_PALETTE = ["#4f86f7", "#6ad7ff", "#e06a8b", "#b07cff", "#46c66d", "#f5a623"];
const MIN_SECTION_MS = 500;

/** Genre starting structures (the "blank-canvas cure"): ordered parts with relative weights. */
export const SECTION_TEMPLATES: Record<string, { label: string; parts: { name: string; weight: number }[] }> = {
  electronic: {
    label: "Electronic",
    parts: [
      { name: "Intro", weight: 1 },
      { name: "Build", weight: 1 },
      { name: "Drop", weight: 2 },
      { name: "Breakdown", weight: 1 },
      { name: "Outro", weight: 1 },
    ],
  },
  rock: {
    label: "Rock",
    parts: [
      { name: "Intro", weight: 1 },
      { name: "Verse", weight: 2 },
      { name: "Chorus", weight: 2 },
      { name: "Bridge", weight: 1 },
      { name: "Outro", weight: 1 },
    ],
  },
  cinematic: {
    label: "Cinematic",
    parts: [
      { name: "Intro", weight: 1 },
      { name: "Tension", weight: 2 },
      { name: "Climax", weight: 2 },
      { name: "Resolution", weight: 1 },
    ],
  },
};

function sectionsOf(arr: Arrangement): Section[] {
  return arr.sections ?? [];
}

/** Append a section spanning [startMs, endMs] (auto-named/coloured). */
export function addSection(arr: Arrangement, startMs: number, endMs: number): Arrangement {
  const s0 = Math.max(0, Math.round(startMs));
  const s1 = Math.max(s0 + MIN_SECTION_MS, Math.round(endMs));
  const sections = sectionsOf(arr);
  const section: Section = {
    id: newId(),
    name: `Section ${sections.length + 1}`,
    startMs: s0,
    endMs: s1,
    color: SECTION_PALETTE[sections.length % SECTION_PALETTE.length],
  };
  return { ...arr, sections: [...sections, section] };
}

export function renameSection(arr: Arrangement, id: string, name: string): Arrangement {
  const trimmed = name.trim();
  if (!trimmed || !sectionsOf(arr).some((s) => s.id === id)) return arr;
  return { ...arr, sections: sectionsOf(arr).map((s) => (s.id === id ? { ...s, name: trimmed } : s)) };
}

/** Move a section to start at `startMs` (clamped >= 0), preserving its length. */
export function moveSection(arr: Arrangement, id: string, startMs: number): Arrangement {
  const at = Math.max(0, Math.round(startMs));
  if (!sectionsOf(arr).some((s) => s.id === id)) return arr;
  return {
    ...arr,
    sections: sectionsOf(arr).map((s) => (s.id === id ? { ...s, startMs: at, endMs: at + (s.endMs - s.startMs) } : s)),
  };
}

/** Set a section's end (drag the right edge); kept at least MIN_SECTION_MS past its start. */
export function resizeSection(arr: Arrangement, id: string, endMs: number): Arrangement {
  if (!sectionsOf(arr).some((s) => s.id === id)) return arr;
  return {
    ...arr,
    sections: sectionsOf(arr).map((s) =>
      s.id === id ? { ...s, endMs: Math.max(s.startMs + MIN_SECTION_MS, Math.round(endMs)) } : s,
    ),
  };
}

export function removeSection(arr: Arrangement, id: string): Arrangement {
  if (!sectionsOf(arr).some((s) => s.id === id)) return arr;
  return { ...arr, sections: sectionsOf(arr).filter((s) => s.id !== id) };
}

/**
 * Replace the sections with a genre template, laid out contiguously from 0 across `totalMs`
 * proportional to each part's weight. Unknown template key → unchanged.
 */
export function applyTemplate(arr: Arrangement, key: string, totalMs: number): Arrangement {
  const tpl = SECTION_TEMPLATES[key];
  if (!tpl) return arr;
  const span = Math.max(MIN_SECTION_MS * tpl.parts.length, Math.round(totalMs));
  const totalWeight = tpl.parts.reduce((n, p) => n + p.weight, 0);
  let cursor = 0;
  const sections: Section[] = tpl.parts.map((part, i) => {
    const start = cursor;
    // Last part absorbs rounding so the sections exactly fill the span.
    const end = i === tpl.parts.length - 1 ? span : Math.round(start + (span * part.weight) / totalWeight);
    cursor = end;
    return {
      id: newId(),
      name: part.name,
      startMs: start,
      endMs: Math.max(start + MIN_SECTION_MS, end),
      color: SECTION_PALETTE[i % SECTION_PALETTE.length],
    };
  });
  return { ...arr, sections };
}
