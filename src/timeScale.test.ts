import { describe, it, expect } from "vitest";
import { pxToMs, msToPx, snapMs, beatMs, barMs, gridMsFor } from "./timeScale";

describe("pxToMs", () => {
  it("converts px to ms using the scale", () => {
    expect(pxToMs(40, 0.04)).toBeCloseTo(1000);
  });

  it("round-trips with msToPx", () => {
    expect(pxToMs(msToPx(2500, 0.04), 0.04)).toBeCloseTo(2500);
  });

  it("clamps negative px to 0 ms", () => {
    expect(pxToMs(-10, 0.04)).toBe(0);
  });

  it("returns 0 when pxPerMs is zero", () => {
    expect(pxToMs(100, 0)).toBe(0);
  });

  it("returns 0 when pxPerMs is negative", () => {
    expect(pxToMs(100, -1)).toBe(0);
  });
});

describe("msToPx", () => {
  it("converts ms to px using the scale", () => {
    expect(msToPx(1000, 0.04)).toBeCloseTo(40);
  });

  it("clamps negative ms to 0 px", () => {
    expect(msToPx(-500, 0.04)).toBe(0);
  });

  it("returns 0 when pxPerMs is zero", () => {
    expect(msToPx(1000, 0)).toBe(0);
  });

  it("returns 0 when pxPerMs is negative", () => {
    expect(msToPx(1000, -1)).toBe(0);
  });
});

describe("snapMs", () => {
  it("snaps to the nearest grid increment", () => {
    expect(snapMs(250, 200)).toBe(200);
    expect(snapMs(350, 200)).toBe(400);
  });

  it("snaps 0 to 0", () => {
    expect(snapMs(0, 200)).toBe(0);
  });

  it("returns the value unchanged when gridMs is 0 or negative (no-op guard)", () => {
    expect(snapMs(350, 0)).toBe(350);
    expect(snapMs(350, -100)).toBe(350);
  });

  it("never returns a negative value", () => {
    expect(snapMs(0, 200)).toBeGreaterThanOrEqual(0);
  });

  it("exact boundary (half-grid) rounds up — Math.round(0.5) = 1 in JS", () => {
    // 100ms is exactly halfway between 0 and 200 — JS Math.round goes up
    expect(snapMs(100, 200)).toBe(200);
    expect(snapMs(99, 200)).toBe(0);
  });
});

describe("musical grid (Slice 7)", () => {
  it("beatMs / barMs from tempo", () => {
    expect(beatMs(120)).toBe(500); // 60000/120
    expect(beatMs(60)).toBe(1000);
    expect(barMs(120, 4)).toBe(2000); // 4 beats × 500
    expect(barMs(90, 3)).toBeCloseTo((60000 / 90) * 3);
    expect(beatMs(0)).toBe(60000); // bpm clamped to >= 1
  });

  it("gridMsFor maps a division to its step (off → 0)", () => {
    expect(gridMsFor("off", 120, 4)).toBe(0);
    expect(gridMsFor("beat", 120, 4)).toBe(500);
    expect(gridMsFor("half", 120, 4)).toBe(250);
    expect(gridMsFor("bar", 120, 4)).toBe(2000);
  });
});
