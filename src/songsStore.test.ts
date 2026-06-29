import { describe, it, expect, beforeEach } from "vitest";
import { loadSongs, saveSongs, createSong, nextSongName } from "./songsStore";
import { newArrangement } from "./arrangementStore";
import type { Arrangement } from "./arrangement";

const SONGS_KEY = "musicware.songs.v1";
const ACTIVE_KEY = "musicware.activeSong.v1";
const LEGACY_KEY = "musicware.arrangements.v1";

beforeEach(() => localStorage.clear());

describe("songsStore — load/save", () => {
  it("returns one default song when nothing is stored", () => {
    const { songs, activeId } = loadSongs();
    expect(songs).toHaveLength(1);
    expect(songs[0].tracks).toHaveLength(3);
    expect(activeId).toBe(songs[0].id);
  });

  it("round-trips a multi-song library + active id", () => {
    const a = { ...newArrangement(), name: "Song 1" };
    const b = { ...newArrangement(), name: "Song 2" };
    saveSongs([a, b], b.id);
    const loaded = loadSongs();
    expect(loaded.songs.map((s) => s.name)).toEqual(["Song 1", "Song 2"]);
    expect(loaded.activeId).toBe(b.id);
  });

  it("falls back to the first song when the stored active id is unknown", () => {
    const a = newArrangement();
    saveSongs([a], "no-such-id");
    expect(loadSongs().activeId).toBe(a.id);
  });

  it("migrates the legacy single arrangement into the library on first load", () => {
    const legacy: Arrangement = { ...newArrangement(), name: "My Old Song" };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const { songs, activeId } = loadSongs();
    expect(songs).toHaveLength(1);
    expect(songs[0].name).toBe("My Old Song");
    expect(activeId).toBe(legacy.id);
  });

  it("prefers the songs list over the legacy key once it exists", () => {
    const legacy = { ...newArrangement(), name: "Legacy" };
    const current = { ...newArrangement(), name: "Current" };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    saveSongs([current], current.id);
    expect(loadSongs().songs.map((s) => s.name)).toEqual(["Current"]);
  });

  it("tolerates corrupt storage (bad JSON / non-array / non-arrangement entries)", () => {
    localStorage.setItem(SONGS_KEY, "{bad json");
    expect(loadSongs().songs).toHaveLength(1); // fresh default, no throw
    localStorage.setItem(SONGS_KEY, JSON.stringify([{ nope: true }, 42]));
    expect(loadSongs().songs).toHaveLength(1); // filtered to nothing → default
  });

  it("ignores a corrupt active id key without throwing", () => {
    const a = newArrangement();
    localStorage.setItem(SONGS_KEY, JSON.stringify([a]));
    localStorage.setItem(ACTIVE_KEY, "garbage");
    expect(loadSongs().activeId).toBe(a.id);
  });
});

describe("nextSongName / createSong", () => {
  it("names the next song one past the highest 'Song N' (gap-safe)", () => {
    const songs = [{ ...newArrangement(), name: "Song 1" }, { ...newArrangement(), name: "Song 3" }, { ...newArrangement(), name: "Jam" }];
    expect(nextSongName(songs)).toBe("Song 4");
    expect(nextSongName([])).toBe("Song 1");
  });

  it("createSong returns a fresh named arrangement with a unique id", () => {
    const a = createSong([]);
    const b = createSong([a]);
    expect(a.name).toBe("Song 1");
    expect(b.name).toBe("Song 2");
    expect(a.id).not.toBe(b.id);
    expect(a.tracks).toHaveLength(3);
  });
});
