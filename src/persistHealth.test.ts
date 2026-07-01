import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reportPersist, persistFailed, subscribePersist, __resetPersistHealth } from "./persistHealth";
import { saveRecordings } from "./recordings";
import { saveSongs } from "./songsStore";

beforeEach(() => __resetPersistHealth());
afterEach(() => vi.restoreAllMocks());

describe("persistHealth signal (DEBT-034)", () => {
  it("starts healthy and flips on a failed persist", () => {
    expect(persistFailed()).toBe(false);
    reportPersist(false);
    expect(persistFailed()).toBe(true);
    reportPersist(true);
    expect(persistFailed()).toBe(false);
  });

  it("notifies subscribers only on a real state change (no churn)", () => {
    const seen: boolean[] = [];
    const unsub = subscribePersist(() => seen.push(persistFailed()));
    reportPersist(true); // still healthy → no notify
    reportPersist(false); // → failed
    reportPersist(false); // no change → no notify
    reportPersist(true); // → healthy
    unsub();
    reportPersist(false); // after unsub → not seen
    expect(seen).toEqual([true, false]);
    expect(persistFailed()).toBe(true);
  });
});

describe("stores report persist failures (DEBT-034)", () => {
  it("saveRecordings flips the signal when setItem throws (quota) and clears on success", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    saveRecordings([]);
    expect(persistFailed()).toBe(true);
    spy.mockRestore();
    saveRecordings([]); // succeeds now
    expect(persistFailed()).toBe(false);
  });

  it("saveSongs flips the signal when setItem throws", () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    saveSongs([], "x");
    expect(persistFailed()).toBe(true);
  });
});
