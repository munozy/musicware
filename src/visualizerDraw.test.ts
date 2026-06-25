import { describe, it, expect } from "vitest";
import { drawScope, drawBars, drawRadial, drawFrame, BARS } from "./visualizerDraw";

// A recording 2D-context mock — jsdom has no canvas, so we exercise the draw paths
// against this and assert the geometry/ops (closes DEBT-022: the rAF draw path was
// never run in CI because getContext was stubbed to null).
function mockCtx({ roundRect = true } = {}) {
  const calls = {
    moveTo: [] as number[][],
    lineTo: [] as number[][],
    rect: [] as number[][],
    roundRect: [] as number[][],
    beginPath: 0,
    closePath: 0,
    stroke: 0,
    fill: 0,
    clearRect: 0,
  };
  const ctx: Record<string, unknown> = {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => void calls.beginPath++,
    closePath: () => void calls.closePath++,
    moveTo: (x: number, y: number) => void calls.moveTo.push([x, y]),
    lineTo: (x: number, y: number) => void calls.lineTo.push([x, y]),
    // Capture ALL args so bad geometry (NaN/Infinity width or height) is caught.
    rect: (x: number, y: number, w: number, h: number) => void calls.rect.push([x, y, w, h]),
    stroke: () => void calls.stroke++,
    fill: () => void calls.fill++,
    clearRect: () => void calls.clearRect++,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    shadowBlur: 0,
    shadowColor: "",
  };
  if (roundRect)
    ctx.roundRect = (x: number, y: number, w: number, h: number, r: number) =>
      void calls.roundRect.push([x, y, w, h, r]);
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const W = 600;
const H = 200;
const finite = (pts: number[][]) => pts.every((p) => p.every(Number.isFinite));

describe("visualizerDraw", () => {
  it("scope strokes a finite polyline; a single note stays in bounds", () => {
    const { ctx, calls } = mockCtx();
    drawScope(ctx, W, H, [60], 1, 1.2);
    expect(calls.stroke).toBe(1);
    expect(calls.moveTo.length).toBe(1);
    expect(calls.lineTo.length).toBeGreaterThan(100);
    expect(finite(calls.moveTo) && finite(calls.lineTo)).toBe(true);
    // n=1 → peak-bounded, so it must stay within the canvas height.
    for (const [x, y] of [...calls.moveTo, ...calls.lineTo]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it("bars fills one rounded rect per bar with finite, in-bounds geometry", () => {
    const { ctx, calls } = mockCtx();
    drawBars(ctx, W, H, [60, 64, 67], 1, 0.5, new Float32Array(BARS));
    expect(calls.roundRect.length).toBe(BARS);
    expect(calls.fill).toBe(BARS);
    expect(finite(calls.roundRect)).toBe(true); // x, y, w, h, r all finite
    for (const [x, y, w, h] of calls.roundRect) {
      expect(w).toBeGreaterThan(0); // real width
      expect(h).toBeGreaterThanOrEqual(0); // non-negative height
      expect(y + h).toBeLessThanOrEqual(H + 0.001); // bottom-anchored, within canvas
      expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("bars falls back to rect() when roundRect is unavailable (older WKWebView)", () => {
    const { ctx, calls } = mockCtx({ roundRect: false });
    drawBars(ctx, W, H, [60], 1, 0.5, new Float32Array(BARS));
    expect(calls.roundRect.length).toBe(0);
    expect(calls.rect.length).toBe(BARS);
    expect(calls.fill).toBe(BARS);
  });

  it("radial strokes a closed finite path", () => {
    const { ctx, calls } = mockCtx();
    drawRadial(ctx, W, H, [60, 67], 1, 0.8);
    expect(calls.stroke).toBe(1);
    expect(calls.closePath).toBe(1);
    expect(finite(calls.moveTo) && finite(calls.lineTo)).toBe(true);
  });

  it("drawFrame clears and dispatches to the chosen style", () => {
    const scope = mockCtx();
    drawFrame(scope.ctx, "scope", W, H, [60], 1, 1, new Float32Array(BARS));
    expect(scope.calls.clearRect).toBe(1);
    expect(scope.calls.stroke).toBe(1);

    const bars = mockCtx();
    drawFrame(bars.ctx, "bars", W, H, [60], 1, 1, new Float32Array(BARS));
    expect(bars.calls.fill).toBe(BARS);

    const radial = mockCtx();
    drawFrame(radial.ctx, "radial", W, H, [60], 1, 1, new Float32Array(BARS));
    expect(radial.calls.closePath).toBe(1);
  });

  it("idle (no notes) still draws a finite shape", () => {
    const { ctx, calls } = mockCtx();
    drawScope(ctx, W, H, [], 0.16, 0);
    expect(calls.stroke).toBe(1);
    expect(finite(calls.lineTo)).toBe(true);
  });
});
