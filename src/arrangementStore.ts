/**
 * Pure load/save/new helpers for the Arrangement — mirrors recordings.ts patterns.
 * localStorage key: `musicware.arrangements.v1`.
 * All functions tolerate missing/corrupt storage by returning a fresh default.
 */

import type { Arrangement, Track, ClipInstance } from "./arrangement";
import { newId } from "./recordings";

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

/**
 * Return a new arrangement with the given clip moved to `startMs` (clamped >= 0).
 * Pure/immutable; finds the clip across all tracks. Time-only — the clip stays on
 * its track (cross-track move is a later slice). Unknown clipId → unchanged.
 */
export function moveClip(arr: Arrangement, clipId: string, startMs: number): Arrangement {
  const at = Math.max(0, Math.round(startMs));
  let found = false;
  const tracks = arr.tracks.map((t) => {
    if (!t.clips.some((c) => c.id === clipId)) return t;
    found = true;
    return {
      ...t,
      clips: t.clips.map((c) => (c.id === clipId ? { ...c, startMs: at } : c)),
    };
  });
  return found ? { ...arr, tracks } : arr;
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
