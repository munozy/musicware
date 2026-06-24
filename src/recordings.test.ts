import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecordings,
  saveRecordings,
  newId,
  nextName,
  formatDuration,
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
