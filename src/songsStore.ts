/**
 * Song library persistence (CRUD). Pre-CRUD the app held ONE arrangement at
 * `musicware.arrangements.v1`; now it holds a LIST of songs plus the active id. A song IS
 * an Arrangement (it already has id/name/createdAt). All reads tolerate missing/corrupt
 * storage and always return at least one song. The legacy single arrangement is migrated
 * into the list on first load so nothing is lost.
 */

import type { Arrangement } from "./arrangement";
import { newArrangement } from "./arrangementStore";

const SONGS_KEY = "musicware.songs.v1";
const ACTIVE_KEY = "musicware.activeSong.v1";
const LEGACY_KEY = "musicware.arrangements.v1"; // the pre-CRUD single arrangement

function isArrangement(x: unknown): x is Arrangement {
  return !!x && typeof x === "object" && Array.isArray((x as Arrangement).tracks) && typeof (x as Arrangement).id === "string";
}

/** Next default song name: "Song N", one past the highest existing "Song <number>". */
export function nextSongName(songs: Arrangement[]): string {
  let max = 0;
  for (const s of songs) {
    const m = /^Song (\d+)$/.exec(s.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Song ${max + 1}`;
}

/** Create a fresh, named song (a default arrangement). */
export function createSong(songs: Arrangement[]): Arrangement {
  return { ...newArrangement(), name: nextSongName(songs) };
}

/**
 * Load the song library + the active song id. Migrates the legacy single arrangement,
 * tolerates corruption, and guarantees a non-empty list with a valid active id.
 */
export function loadSongs(): { songs: Arrangement[]; activeId: string } {
  let songs: Arrangement[] = [];
  try {
    const raw = localStorage.getItem(SONGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) songs = parsed.filter(isArrangement);
    }
  } catch {
    songs = [];
  }

  // First run after the CRUD upgrade: adopt the legacy single arrangement if present.
  if (songs.length === 0) {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (isArrangement(parsed)) songs = [parsed];
      }
    } catch {
      /* ignore */
    }
  }

  if (songs.length === 0) songs = [{ ...newArrangement(), name: "Song 1" }];

  let activeId = "";
  try {
    activeId = localStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    activeId = "";
  }
  if (!songs.some((s) => s.id === activeId)) activeId = songs[0].id;

  return { songs, activeId };
}

/**
 * Append a song to the persisted library (used by video-project import, which adds the
 * embedded soundtrack from outside the useArrangement hook). Keeps the current active id; a
 * mounted useArrangement re-reads this on its next mount.
 */
export function addSongToLibrary(song: Arrangement): void {
  const { songs, activeId } = loadSongs();
  saveSongs([...songs, song], activeId);
}

/** Persist the whole library + active id (try/catch like the other stores). */
export function saveSongs(songs: Arrangement[], activeId: string): void {
  try {
    localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch (e) {
    console.error("failed to persist songs", e);
  }
}
