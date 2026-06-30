import { describe, it, expect } from "vitest";
import { suggestForSection } from "./suggest";
import type { Recording } from "./recordings";

const rec = (id: string, durationMs: number): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs,
  events: [],
});

describe("suggestForSection", () => {
  it("ranks by duration-fit and computes the loop count to fill the section", () => {
    // 8s section: a 2s take loops 4× (perfect), a 4s take loops 2× (perfect), a 3s take loops
    // ~3× = 9s (close), a 5s take loops ~2× = 10s (looser).
    const out = suggestForSection(8000, [rec("five", 5000), rec("three", 3000), rec("two", 2000), rec("four", 4000)]);
    const byId = Object.fromEntries(out.map((s) => [s.recording.id, s]));
    expect(byId.two.loopCount).toBe(4);
    expect(byId.four.loopCount).toBe(2);
    expect(byId.two.score).toBeCloseTo(1); // exact fill
    expect(byId.four.score).toBeCloseTo(1);
    // perfect fits rank ahead of the looser ones
    expect(["two", "four"]).toContain(out[0].recording.id);
    expect(out[out.length - 1].recording.id).toBe("five"); // worst fit last
  });

  it("ties prefer fewer loops (4s 2× beats 2s 4× when both fill exactly)", () => {
    const out = suggestForSection(8000, [rec("two", 2000), rec("four", 4000)]);
    expect(out[0].recording.id).toBe("four"); // same score → fewer loops wins
  });

  it("skips zero-length takes and caps to max; empty input → []", () => {
    expect(suggestForSection(5000, [])).toEqual([]);
    const out = suggestForSection(5000, [rec("ok", 1000), rec("bad", 0)], 1);
    expect(out).toHaveLength(1);
    expect(out[0].recording.id).toBe("ok");
  });

  it("a take longer than the section still loops once (reason notes the fit)", () => {
    const out = suggestForSection(2000, [rec("long", 10000)]);
    expect(out[0].loopCount).toBe(1);
    expect(typeof out[0].reason).toBe("string");
  });
});
