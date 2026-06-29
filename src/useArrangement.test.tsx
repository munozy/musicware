import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";

import { useArrangement } from "./useArrangement";
import { newArrangement, saveArrangement } from "./arrangementStore";
import { loadSongs } from "./songsStore";
import type { Recording } from "./recordings";

// Persistence now lives in the song library; read back the active song to assert it.
const readActiveSong = () => {
  const { songs, activeId } = loadSongs();
  return songs.find((s) => s.id === activeId) ?? songs[0];
};

// A minimal recording with one note on/off.
const makeRec = (id: string, startNote = 60): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs: 500,
  events: [
    { t: 0, kind: "preset", index: 0 },
    { t: 0, kind: "on", note: startNote },
    { t: 400, kind: "off", note: startNote },
  ],
});

const callsFor = (cmd: string) =>
  vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useArrangement — placeClip + persistence", () => {
  it("placeClip adds a clip to state and persists it", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;

    act(() => result.current.placeClip(trackId, "rec-1", 1000));

    expect(result.current.arrangement.tracks[0].clips).toHaveLength(1);
    expect(result.current.arrangement.tracks[0].clips[0].recordingId).toBe("rec-1");
    expect(result.current.arrangement.tracks[0].clips[0].startMs).toBe(1000);

    // Verify persistence — load from localStorage
    const persisted = readActiveSong();
    expect(persisted.tracks[0].clips).toHaveLength(1);
    expect(persisted.tracks[0].clips[0].recordingId).toBe("rec-1");
  });

  it("multiple placeClip calls accumulate clips immutably", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;

    act(() => result.current.placeClip(trackId, "r1", 0));
    act(() => result.current.placeClip(trackId, "r2", 500));

    expect(result.current.arrangement.tracks[0].clips).toHaveLength(2);
  });

  it("moveClip repositions a placed clip and persists the new startMs", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;

    act(() => result.current.placeClip(trackId, "r1", 1000));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;
    act(() => result.current.moveClip(clipId, 3000));

    expect(result.current.arrangement.tracks[0].clips[0].startMs).toBe(3000);
    expect(readActiveSong().tracks[0].clips[0].startMs).toBe(3000);
  });
});

describe("useArrangement — play/stop", () => {
  it("play schedules note_on for a placed clip and sets isPlaying", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1");

    act(() => result.current.placeClip(trackId, "r1", 0));
    vi.mocked(invoke).mockClear();

    act(() => result.current.play([rec]));
    expect(result.current.isPlaying).toBe(true);

    // Advance past t=0 events
    act(() => vi.advanceTimersByTime(10));
    expect(callsFor("note_on")).toHaveLength(1);
    expect(callsFor("note_on")[0][1]).toEqual({ note: 60 });
  });

  it("play is a no-op when already playing", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1");

    act(() => result.current.placeClip(trackId, "r1", 0));
    act(() => result.current.play([rec]));
    vi.mocked(invoke).mockClear();
    act(() => result.current.play([rec])); // second call — should not re-schedule

    // note_on should fire only once (from first play)
    act(() => vi.advanceTimersByTime(10));
    expect(callsFor("note_on")).toHaveLength(1);
  });

  it("stop releases held notes (no stuck note)", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1");

    act(() => result.current.placeClip(trackId, "r1", 0));
    act(() => result.current.play([rec]));
    act(() => vi.advanceTimersByTime(10)); // on(60) fired, off(60) at t=400 not yet

    vi.mocked(invoke).mockClear();
    act(() => result.current.stop());

    // playArrangement.stop() emits note_off for anything still sounding
    expect(callsFor("note_off").map(([, a]) => a)).toContainEqual({ note: 60 });
    expect(result.current.isPlaying).toBe(false);
  });

  it("clears isPlaying after all events complete", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1"); // durationMs = 500

    act(() => result.current.placeClip(trackId, "r1", 0));
    act(() => result.current.play([rec]));
    expect(result.current.isPlaying).toBe(true);

    // Advance past durationMs + 1
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.isPlaying).toBe(false);
  });

  it("emits note_off on NATURAL completion (not only on stop/unmount)", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1"); // off scheduled at t=400

    act(() => result.current.placeClip(trackId, "r1", 0));
    vi.mocked(invoke).mockClear();
    act(() => result.current.play([rec]));
    act(() => vi.advanceTimersByTime(450)); // past the t=400 off

    expect(callsFor("note_off").map(([, a]) => a)).toContainEqual({ note: 60 });
  });
});

describe("useArrangement — unmount cleanup", () => {
  it("calls stop on unmount to release any held notes (no stranded voice)", () => {
    const { result, unmount } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1");

    act(() => result.current.placeClip(trackId, "r1", 0));
    act(() => result.current.play([rec]));
    act(() => vi.advanceTimersByTime(10)); // note on at t=0 has fired

    vi.mocked(invoke).mockClear();
    act(() => unmount());

    // The stop on unmount should emit note_off for the held note
    expect(callsFor("note_off").map(([, a]) => a)).toContainEqual({ note: 60 });
  });
});

describe("useArrangement — loads persisted arrangement on mount", () => {
  it("initialises from localStorage on first render", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    // Manually simulate a previously-saved arrangement with a clip
    const rec = makeRec("r1");
    const withClip = {
      ...arr,
      tracks: arr.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: [
                {
                  id: "clip-1",
                  recordingId: rec.id,
                  startMs: 0,
                  transpose: 0,
                  loopCount: 1,
                },
              ],
            }
          : t,
      ),
    };
    saveArrangement(withClip);

    const { result } = renderHook(() => useArrangement());
    expect(result.current.arrangement.tracks[0].clips).toHaveLength(1);
    expect(result.current.arrangement.tracks[0].clips[0].recordingId).toBe(rec.id);
  });
});

describe("useArrangement — track management", () => {
  it("addTrack appends and removeTrack removes, persisting both", () => {
    const { result } = renderHook(() => useArrangement());
    const initial = result.current.arrangement.tracks.length; // 3

    act(() => result.current.addTrack());
    expect(result.current.arrangement.tracks).toHaveLength(initial + 1);
    expect(readActiveSong().tracks).toHaveLength(initial + 1);

    const lastId = result.current.arrangement.tracks[initial].id;
    act(() => result.current.removeTrack(lastId));
    expect(result.current.arrangement.tracks).toHaveLength(initial);
    expect(readActiveSong().tracks).toHaveLength(initial);
  });
});

describe("useArrangement — song library CRUD", () => {
  it("starts with one song and creates more, switching to the new one", () => {
    const { result } = renderHook(() => useArrangement());
    expect(result.current.songs).toHaveLength(1);
    const first = result.current.activeSongId;

    act(() => result.current.newSong());
    expect(result.current.songs).toHaveLength(2);
    expect(result.current.activeSongId).not.toBe(first); // switched to the new song
    expect(result.current.arrangement.tracks[0].clips).toHaveLength(0); // a fresh, empty song
  });

  it("edits the active song independently of the others", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 0)); // edit song 1
    act(() => result.current.newSong()); // song 2 (now active)
    expect(result.current.arrangement.tracks[0].clips).toHaveLength(0); // song 2 untouched

    const songOne = result.current.songs[0].id;
    act(() => result.current.selectSong(songOne));
    expect(result.current.arrangement.tracks[0].clips).toHaveLength(1); // song 1 kept its clip
  });

  it("renames the active song and persists it", () => {
    const { result } = renderHook(() => useArrangement());
    const id = result.current.activeSongId;
    act(() => result.current.renameSong(id, "  Chiptune  "));
    expect(result.current.arrangement.name).toBe("Chiptune");
    expect(readActiveSong().name).toBe("Chiptune");
  });

  it("deletes a song (picking a survivor) but refuses to delete the last one", () => {
    const { result } = renderHook(() => useArrangement());
    act(() => result.current.newSong());
    expect(result.current.songs).toHaveLength(2);
    const activeId = result.current.activeSongId;

    act(() => result.current.deleteSong(activeId));
    expect(result.current.songs).toHaveLength(1);
    expect(result.current.songs.some((s) => s.id === activeId)).toBe(false);
    expect(result.current.activeSongId).toBe(result.current.songs[0].id); // fell back to survivor

    act(() => result.current.deleteSong(result.current.activeSongId));
    expect(result.current.songs).toHaveLength(1); // refuses to remove the last song
  });

  it("importSong adds the song and switches to it", () => {
    const { result } = renderHook(() => useArrangement());
    const before = result.current.songs.length;
    const imported = { ...newArrangement(), name: "Imported" };
    act(() => result.current.importSong(imported));
    expect(result.current.songs).toHaveLength(before + 1);
    expect(result.current.activeSongId).toBe(imported.id);
    expect(result.current.arrangement.name).toBe("Imported");
  });
});

describe("useArrangement — removeClip + playhead timing", () => {
  it("removeClip removes a placed clip", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 0));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;
    act(() => result.current.removeClip(clipId));
    expect(result.current.arrangement.tracks[0].clips).toHaveLength(0);
  });

  it("sets playStartedAt on play and clears it on stop", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    const rec = makeRec("r1");
    act(() => result.current.placeClip(trackId, "r1", 0));
    expect(result.current.playStartedAt).toBeNull();
    act(() => result.current.play([rec]));
    expect(result.current.playStartedAt).not.toBeNull();
    act(() => result.current.stop());
    expect(result.current.playStartedAt).toBeNull();
  });
});

describe("useArrangement — mute/solo + preview", () => {
  it("toggleMute / toggleSolo flip the track flags", () => {
    const { result } = renderHook(() => useArrangement());
    const id = result.current.arrangement.tracks[0].id;
    act(() => result.current.toggleMute(id));
    expect(result.current.arrangement.tracks[0].muted).toBe(true);
    act(() => result.current.toggleSolo(id));
    expect(result.current.arrangement.tracks[0].soloed).toBe(true);
  });

  it("previewRecording sets previewingId; clicking the same one again stops it", () => {
    const { result } = renderHook(() => useArrangement());
    const rec = makeRec("r1");
    act(() => result.current.previewRecording(rec));
    expect(result.current.previewingId).toBe("r1");
    act(() => result.current.previewRecording(rec)); // toggle off
    expect(result.current.previewingId).toBeNull();
  });

  it("toggleClipMute flips a placed clip's muted flag", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 0));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;
    act(() => result.current.toggleClipMute(clipId));
    expect(result.current.arrangement.tracks[0].clips[0].muted).toBe(true);
  });
});

describe("useArrangement — clip editing (Slice 5)", () => {
  it("duplicateClip appends a copy after the original and persists it", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 0));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;

    act(() => result.current.duplicateClip(clipId, 2000));
    const clips = result.current.arrangement.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[1].recordingId).toBe("r1");
    expect(clips[1].startMs).toBe(2000);
    expect(clips[1].id).not.toBe(clipId);
    expect(readActiveSong().tracks[0].clips).toHaveLength(2); // persisted
  });

  it("setClipLoop and transposeClip update the clip and persist", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 0));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;

    act(() => result.current.setClipLoop(clipId, 3));
    act(() => result.current.transposeClip(clipId, -4));
    const clip = result.current.arrangement.tracks[0].clips[0];
    expect(clip.loopCount).toBe(3);
    expect(clip.transpose).toBe(-4);
    const persisted = readActiveSong().tracks[0].clips[0];
    expect(persisted.loopCount).toBe(3);
    expect(persisted.transpose).toBe(-4);
  });

  it("trimClip sets the trim window (and an optional shifted startMs) and persists", () => {
    const { result } = renderHook(() => useArrangement());
    const trackId = result.current.arrangement.tracks[0].id;
    act(() => result.current.placeClip(trackId, "r1", 1000));
    const clipId = result.current.arrangement.tracks[0].clips[0].id;

    act(() => result.current.trimClip(clipId, { trimStartMs: 200, startMs: 1200 }));
    const clip = result.current.arrangement.tracks[0].clips[0];
    expect(clip.trimStartMs).toBe(200);
    expect(clip.startMs).toBe(1200);
    expect(readActiveSong().tracks[0].clips[0].trimStartMs).toBe(200);
  });
});
