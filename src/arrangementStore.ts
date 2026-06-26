/**
 * Pure load/save/new helpers for the Arrangement — mirrors recordings.ts patterns.
 * localStorage key: `musicware.arrangements.v1`.
 * All functions tolerate missing/corrupt storage by returning a fresh default.
 */

import type { Arrangement, Track, ClipInstance } from "./arrangement";
import { newId } from "./recordings";

const STORAGE_KEY = "musicware.arrangements.v1";

// Distinct lane colours so the three default tracks read as separate places to
// stack bricks (the building-block recombination the workspace exists for).
const TRACK_COLORS = ["#7c5cff", "#1fa8a0", "#e06a8b"];

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
    tracks: TRACK_COLORS.map((c, i) => makeDefaultTrack(i + 1, c)),
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
