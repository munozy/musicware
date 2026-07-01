import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";

// Voice-blob cleanup (DEBT-034): stub the IndexedDB + decoded-buffer stores so we can assert the
// finalize path frees them without a real IndexedDB/AudioContext in jsdom.
vi.mock("./voiceStore", () => ({ deleteBlob: vi.fn(() => Promise.resolve()) }));
vi.mock("./voiceAudio", () => ({ clearVoiceBuffer: vi.fn() }));
import { deleteBlob } from "./voiceStore";
import { clearVoiceBuffer } from "./voiceAudio";

import { useRecorder, UNDO_MS } from "./useRecorder";
import * as synth from "./synth";
import { loadRecordings, type Recording } from "./recordings";

const voiceTake = (id: string, blobKey: string): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs: 1000,
  kind: "voice",
  events: [],
  audio: { blobKey, mimeType: "audio/webm", effect: "none" },
});

const calls = () => vi.mocked(invoke).mock.calls.map((c) => [c[0], c[1]]);

// Drive performance.now() deterministically; setTimeout/Interval stay faked.
let nowMs = 0;
const setNow = (v: number) => {
  nowMs = v;
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  setNow(0);
  synth.setSynthSink(null);
  synth.emit({ kind: "preset", index: 0 }); // reset the module's current preset
  vi.mocked(invoke).mockClear();
  vi.mocked(deleteBlob).mockClear();
  vi.mocked(clearVoiceBuffer).mockClear();
});

afterEach(() => {
  synth.setSynthSink(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRecorder — capture", () => {
  it("captures the live stream with timestamps and the active preset at t=0", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());

    setNow(120);
    act(() => synth.noteOn(60));
    setNow(320);
    act(() => synth.noteOff(60));
    setNow(500);
    act(() => result.current.stopRecording());

    expect(result.current.recordings).toHaveLength(1);
    const rec = result.current.recordings[0];
    expect(rec.durationMs).toBe(500);
    expect(rec.events).toEqual([
      { t: 0, kind: "preset", index: 0 },
      { t: 120, kind: "on", note: 60 },
      { t: 320, kind: "off", note: 60 },
    ]);
  });

  it("stamps the CURRENT timbre at t=0 so replay uses the right instrument", () => {
    act(() => synth.setPreset(3)); // Bells, before recording
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(72));
    setNow(200);
    act(() => result.current.stopRecording());

    expect(result.current.recordings[0].events[0]).toEqual({ t: 0, kind: "preset", index: 3 });
  });

  it("auto-closes a note still held when recording stops (self-contained take)", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(64)); // never released
    setNow(400);
    act(() => result.current.stopRecording());

    expect(result.current.recordings[0].events).toContainEqual({ t: 400, kind: "off", note: 64 });
  });

  it("discards a take with no notes", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(50);
    act(() => synth.setPreset(2)); // a preset change but no notes played
    setNow(100);
    act(() => result.current.stopRecording());

    expect(result.current.recordings).toHaveLength(0);
  });

  it("ignores a second startRecording while already recording (no duplicate capture)", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    act(() => result.current.startRecording()); // guarded no-op
    setNow(100);
    act(() => synth.noteOn(60));
    setNow(200);
    act(() => synth.noteOff(60));
    setNow(300);
    act(() => result.current.stopRecording());

    expect(result.current.recordings).toHaveLength(1);
    const ons = result.current.recordings[0].events.filter((e) => e.kind === "on");
    expect(ons).toHaveLength(1); // one sink installed → no doubled events
  });
});

describe("useRecorder — playback", () => {
  const seedTake = (result: { current: ReturnType<typeof useRecorder> }) => {
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(60));
    setNow(200);
    act(() => synth.noteOff(60));
    setNow(300);
    act(() => result.current.stopRecording());
    return result.current.recordings[0].id;
  };

  it("replays a take by re-dispatching events in order", () => {
    const { result } = renderHook(() => useRecorder());
    const id = seedTake(result);
    vi.mocked(invoke).mockClear();

    act(() => result.current.play(id));
    act(() => vi.advanceTimersByTime(250));

    expect(calls()).toContainEqual(["set_preset", { index: 0 }]);
    expect(calls()).toContainEqual(["note_on", { note: 60 }]);
    expect(calls()).toContainEqual(["note_off", { note: 60 }]);

    act(() => vi.advanceTimersByTime(200)); // past the end marker
    expect(result.current.playingId).toBeNull();
  });

  it("releases a sounding note if playback is stopped early (no stuck note)", () => {
    const { result } = renderHook(() => useRecorder());
    // A take with a long gap: on at 10ms, off only at 1000ms.
    act(() => result.current.startRecording());
    setNow(10);
    act(() => synth.noteOn(67));
    setNow(1000);
    act(() => synth.noteOff(67));
    act(() => result.current.stopRecording());
    const id = result.current.recordings[0].id;

    act(() => result.current.play(id));
    act(() => vi.advanceTimersByTime(20)); // fires preset + on(67), not the off
    vi.mocked(invoke).mockClear();
    act(() => result.current.stopPlayback());

    expect(calls()).toContainEqual(["note_off", { note: 67 }]);
    expect(result.current.playingId).toBeNull();
  });

  it("tracks playback progress 0→1 over the TRIMMED span (not the raw duration)", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(62)); // first (and only) note at 100ms — 100ms of leading silence
    setNow(300);
    act(() => result.current.stopRecording()); // held note closes at 300; durationMs 300
    const id = result.current.recordings[0].id;

    act(() => result.current.play(id)); // start = performance.now() = 300
    expect(result.current.playProgress).toBe(0);
    setNow(400); // 100ms in; trimmed span is 200ms (off@300 − on@100), so 100/200 = 0.5
    act(() => vi.advanceTimersByTime(50)); // progress interval fires
    expect(result.current.playProgress).toBeCloseTo(0.5, 2);
  });

  it("trims LEADING silence — the first note fires immediately, not after the gap", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(500);
    act(() => synth.noteOn(60)); // 500ms of dead air before the first note
    setNow(700);
    act(() => synth.noteOff(60));
    setNow(2000);
    act(() => result.current.stopRecording());
    const id = result.current.recordings[0].id;
    vi.mocked(invoke).mockClear();

    act(() => result.current.play(id));
    act(() => vi.advanceTimersByTime(1)); // barely any time — yet the note should already sound
    expect(calls()).toContainEqual(["note_on", { note: 60 }]); // leading 500ms skipped
  });

  it("trims TRAILING silence — playback ends just after the last note, not at the stop time", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(500);
    act(() => synth.noteOn(60));
    setNow(700);
    act(() => synth.noteOff(60)); // last note ends at 700ms…
    setNow(2000);
    act(() => result.current.stopRecording()); // …but the user stopped 1.3s later
    const id = result.current.recordings[0].id;

    act(() => result.current.play(id));
    act(() => vi.advanceTimersByTime(250)); // span is 200ms (700−500), end marker at 201
    expect(calls()).toContainEqual(["note_off", { note: 60 }]);
    expect(result.current.playingId).toBeNull(); // ended at ~201ms, not durationMs+1 (2001ms)
  });

  it("releases sounding notes when the hook unmounts mid-playback (no stranded voice)", () => {
    const { result, unmount } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(10);
    act(() => synth.noteOn(67));
    setNow(1000);
    act(() => synth.noteOff(67));
    act(() => result.current.stopRecording());
    const id = result.current.recordings[0].id;

    act(() => result.current.play(id));
    act(() => vi.advanceTimersByTime(20)); // on(67) fired, off (t=1000) not yet
    vi.mocked(invoke).mockClear();
    act(() => unmount()); // e.g. HMR / navigation while a take is still playing

    expect(calls()).toContainEqual(["note_off", { note: 67 }]);
  });
});

describe("useRecorder — rename / delete / persistence", () => {
  const seedTake = (result: { current: ReturnType<typeof useRecorder> }) => {
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(62));
    setNow(300);
    act(() => result.current.stopRecording());
    return result.current.recordings[0].id;
  };

  it("renames a recording and persists it", () => {
    const { result } = renderHook(() => useRecorder());
    const id = seedTake(result);

    act(() => result.current.rename(id, "  Intro riff  "));
    expect(result.current.recordings[0].name).toBe("Intro riff"); // trimmed
    expect(loadRecordings()[0].name).toBe("Intro riff");
  });

  it("ignores a blank rename", () => {
    const { result } = renderHook(() => useRecorder());
    const id = seedTake(result);
    const before = result.current.recordings[0].name;
    act(() => result.current.rename(id, "   "));
    expect(result.current.recordings[0].name).toBe(before);
  });

  it("deletes a recording and persists the removal", () => {
    const { result } = renderHook(() => useRecorder());
    const id = seedTake(result);
    expect(result.current.recordings).toHaveLength(1);

    act(() => result.current.remove(id));
    expect(result.current.recordings).toHaveLength(0);
    expect(loadRecordings()).toHaveLength(0);
  });

  it("auto-numbers successive takes (create many)", () => {
    const { result } = renderHook(() => useRecorder());
    seedTake(result);
    seedTake(result);
    expect(result.current.recordings.map((r) => r.name)).toEqual([
      "Composition 1",
      "Composition 2",
    ]);
  });

  it("restores a deleted take at its original position via undo", () => {
    const { result } = renderHook(() => useRecorder());
    seedTake(result);
    seedTake(result); // [Composition 1, Composition 2]
    const [aId, bId] = result.current.recordings.map((r) => r.id);

    act(() => result.current.remove(aId)); // delete the first
    expect(result.current.recordings.map((r) => r.id)).toEqual([bId]);
    expect(result.current.pendingDelete?.recording.id).toBe(aId);

    act(() => result.current.undoDelete());
    expect(result.current.recordings.map((r) => r.id)).toEqual([aId, bId]); // back at index 0
    expect(result.current.pendingDelete).toBeNull();
  });

  it("finalizes the delete after the undo window (UNDO_MS)", () => {
    const { result } = renderHook(() => useRecorder());
    const id = seedTake(result);
    act(() => result.current.remove(id));
    expect(result.current.pendingDelete?.recording.id).toBe(id);

    act(() => vi.advanceTimersByTime(UNDO_MS + 10));
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.recordings).toHaveLength(0);
    expect(loadRecordings()).toHaveLength(0);
  });

  it("keeps a single undo slot — a second delete finalizes the first", () => {
    const { result } = renderHook(() => useRecorder());
    seedTake(result);
    seedTake(result);
    const [aId, bId] = result.current.recordings.map((r) => r.id);

    act(() => result.current.remove(aId));
    act(() => result.current.remove(bId)); // finalizes a, b is now pending
    expect(result.current.pendingDelete?.recording.id).toBe(bId);

    act(() => result.current.undoDelete()); // only b returns
    const ids = result.current.recordings.map((r) => r.id);
    expect(ids).toContain(bId);
    expect(ids).not.toContain(aId);
    expect(loadRecordings().map((r) => r.id)).not.toContain(aId); // a stayed finalized in storage
  });

  it("addRecordings appends several takes at once and persists them (song-project import)", () => {
    const { result } = renderHook(() => useRecorder());
    const mk = (id: string) => ({ id, name: id, createdAt: 0, durationMs: 1000, events: [] });
    act(() => result.current.addRecordings([mk("i1"), mk("i2")]));
    expect(result.current.recordings.map((r) => r.id)).toEqual(["i1", "i2"]);
    expect(loadRecordings().map((r) => r.id)).toEqual(["i1", "i2"]); // persisted
    act(() => result.current.addRecordings([])); // no-op
    expect(result.current.recordings).toHaveLength(2);
  });
});

describe("useRecorder — voice-take blob cleanup (DEBT-034)", () => {
  it("frees the IndexedDB blob + decoded buffer when a voice delete becomes FINAL (undo window elapses)", () => {
    localStorage.setItem("musicware.recordings.v1", JSON.stringify([voiceTake("v1", "blob-v1")]));
    const { result } = renderHook(() => useRecorder());

    act(() => result.current.remove("v1"));
    expect(deleteBlob).not.toHaveBeenCalled(); // still undoable → blob preserved

    act(() => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(deleteBlob).toHaveBeenCalledWith("blob-v1");
    expect(clearVoiceBuffer).toHaveBeenCalledWith("blob-v1");
  });

  it("does NOT free the blob when the delete is UNDONE", () => {
    localStorage.setItem("musicware.recordings.v1", JSON.stringify([voiceTake("v1", "blob-v1")]));
    const { result } = renderHook(() => useRecorder());

    act(() => result.current.remove("v1"));
    act(() => result.current.undoDelete());
    act(() => vi.advanceTimersByTime(UNDO_MS + 1)); // window would have elapsed, but it's restored

    expect(deleteBlob).not.toHaveBeenCalled();
    expect(result.current.recordings.map((r) => r.id)).toEqual(["v1"]);
  });

  it("finalizes a superseded pending delete (a second delete makes the first permanent)", () => {
    localStorage.setItem(
      "musicware.recordings.v1",
      JSON.stringify([voiceTake("v1", "blob-v1"), voiceTake("v2", "blob-v2")]),
    );
    const { result } = renderHook(() => useRecorder());

    act(() => result.current.remove("v1"));
    act(() => result.current.remove("v2")); // supersedes v1's pending delete → v1 is now final
    expect(deleteBlob).toHaveBeenCalledWith("blob-v1");
    expect(deleteBlob).not.toHaveBeenCalledWith("blob-v2"); // v2 still undoable

    act(() => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(deleteBlob).toHaveBeenCalledWith("blob-v2");
  });

  it("keyboard takes never touch the blob store", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.addRecording({ id: "k1", name: "k1", createdAt: 0, durationMs: 100, events: [] }));
    act(() => result.current.remove("k1"));
    act(() => vi.advanceTimersByTime(UNDO_MS + 1));
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(clearVoiceBuffer).not.toHaveBeenCalled();
  });
});
