import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecordings,
  saveRecordings,
  newId,
  nextName,
  formatDuration,
  isVoice,
  type Recording,
} from "./recordings";

const mk = (name: string): Recording => ({
  id: newId(),
  name,
  createdAt: 0,
  durationMs: 1000,
  events: [{ t: 0, kind: "preset", index: 0 }],
});

describe("recordings store", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through localStorage", () => {
    const list = [mk("Composition 1"), mk("Composition 2")];
    saveRecordings(list);
    expect(loadRecordings()).toEqual(list);
  });

  it("returns [] when nothing is saved", () => {
    expect(loadRecordings()).toEqual([]);
  });

  it("tolerates corrupt storage without throwing", () => {
    localStorage.setItem("musicware.recordings.v1", "{not json");
    expect(loadRecordings()).toEqual([]);
    localStorage.setItem("musicware.recordings.v1", '{"obj":true}'); // not an array
    expect(loadRecordings()).toEqual([]);
  });
});

describe("nextName", () => {
  it("starts at 1 for an empty library", () => {
    expect(nextName([])).toBe("Composition 1");
  });

  it("is one past the highest existing Composition number (gap-safe)", () => {
    // Deleting the middle still yields a unique next name.
    const list = [mk("Composition 1"), mk("Composition 3"), mk("My Jam")];
    expect(nextName(list)).toBe("Composition 4");
  });

  it("uses a custom prefix (voice takes get 'Voice N', independent of Composition numbers)", () => {
    const list = [mk("Composition 5"), mk("Voice 1"), mk("Voice 2")];
    expect(nextName(list, "Voice")).toBe("Voice 3");
    expect(nextName(list)).toBe("Composition 6"); // the Composition counter is unaffected
  });
});

describe("isVoice", () => {
  it("is true only for kind === 'voice' (undefined ⇒ keyboard, back-compat)", () => {
    expect(isVoice({ ...mk("a"), kind: "voice" })).toBe(true);
    expect(isVoice({ ...mk("b"), kind: "keyboard" })).toBe(false);
    expect(isVoice(mk("c"))).toBe(false); // no kind ⇒ legacy keyboard take
  });
});

describe("formatDuration", () => {
  it("formats ms as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(3000)).toBe("0:03");
    expect(formatDuration(75_000)).toBe("1:15");
  });
});

describe("newId", () => {
  it("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });
});
