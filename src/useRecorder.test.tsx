import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";

import { useRecorder, UNDO_MS } from "./useRecorder";
import * as synth from "./synth";
import { loadRecordings } from "./recordings";

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

  it("tracks playback progress 0→1 as a take plays", () => {
    const { result } = renderHook(() => useRecorder());
    act(() => result.current.startRecording());
    setNow(100);
    act(() => synth.noteOn(62));
    setNow(300);
    act(() => result.current.stopRecording()); // duration 300ms
    const id = result.current.recordings[0].id;

    act(() => result.current.play(id)); // start = performance.now() = 300
    expect(result.current.playProgress).toBe(0);
    setNow(450); // 150ms into a 300ms take
    act(() => vi.advanceTimersByTime(50)); // progress interval fires
    expect(result.current.playProgress).toBeCloseTo(0.5, 2);
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
});
