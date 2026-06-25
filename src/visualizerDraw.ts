import { noteToFreq } from "./notes";
import type { VizStyle } from "./visualizerStyles";

// Pure canvas-draw routines for the visualizer, factored out of the component so
// they can be unit-tested without a real canvas or rAF loop (the React layer just
// owns the loop + state; these own the geometry).

export const BARS = 40;

type Ctx = CanvasRenderingContext2D;

function gradient(ctx: Ctx, w: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "#6ad7ff");
  g.addColorStop(0.5, "#4f86f7");
  g.addColorStop(1, "#b07cff");
  return g;
}

export function drawScope(ctx: Ctx, w: number, h: number, notes: number[], amp: number, phase: number) {
  const mid = h / 2;
  const comps = (notes.length ? notes : [45]).map((n) => ({
    cycles: Math.max(1, Math.min(48, noteToFreq(n) / 38)),
    speed: 0.6 + (n % 12) * 0.08,
  }));
  const norm = 1 / Math.sqrt(comps.length);
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const t = x / w;
    let y = 0;
    for (const c of comps) y += Math.sin(t * c.cycles * Math.PI * 2 + phase * c.speed);
    const py = mid - y * norm * amp * (mid - 8);
    x === 0 ? ctx.moveTo(x, py) : ctx.lineTo(x, py);
  }
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = gradient(ctx, w);
  ctx.stroke();
}

export function drawBars(
  ctx: Ctx,
  w: number,
  h: number,
  notes: number[],
  amp: number,
  phase: number,
  barHeights: Float32Array,
) {
  const gap = 3;
  const bw = (w - gap * (BARS - 1)) / BARS;
  const g = gradient(ctx, w);
  for (let i = 0; i < BARS; i++) {
    // Map this bar to a note in the C1..C6 range; lit if a held note is near.
    const noteForBar = 24 + (i / (BARS - 1)) * 60;
    const lit = notes.some((n) => Math.abs(n - noteForBar) < 30 / BARS + 0.9);
    const target = lit ? 0.55 + 0.45 * Math.abs(Math.sin(phase * 1.4 + i)) : 0.06;
    barHeights[i] += (target - barHeights[i]) * 0.18;
    const bh = barHeights[i] * (h - 8) * Math.max(amp, 0.5);
    const x = i * (bw + gap);
    ctx.fillStyle = g;
    ctx.beginPath();
    // roundRect is unsupported on older WKWebView — fall back to a plain rect so
    // Bars never renders blank.
    if (ctx.roundRect) ctx.roundRect(x, h - bh, bw, bh, 3);
    else ctx.rect(x, h - bh, bw, bh);
    ctx.fill();
  }
}

export function drawRadial(ctx: Ctx, w: number, h: number, notes: number[], amp: number, phase: number) {
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * 0.2;
  const comps = (notes.length ? notes : [45]).map((n) => ({
    lobes: (Math.max(2, Math.round(noteToFreq(n) / 60) % 9) + 2),
    speed: 0.5 + (n % 12) * 0.06,
  }));
  const norm = 1 / Math.sqrt(comps.length);
  ctx.beginPath();
  const STEPS = 180;
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    let r = 0;
    for (const c of comps) r += Math.sin(a * c.lobes + phase * c.speed);
    const rad = base + r * norm * amp * base * 0.8;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = gradient(ctx, w);
  ctx.stroke();
}

/** Render one frame of the chosen style (clear + glow + style draw). */
export function drawFrame(
  ctx: Ctx,
  style: VizStyle,
  w: number,
  h: number,
  notes: number[],
  amp: number,
  phase: number,
  barHeights: Float32Array,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.shadowBlur = notes.length ? 16 : 6;
  ctx.shadowColor = "#4f86f7";
  if (style === "bars") drawBars(ctx, w, h, notes, amp, phase, barHeights);
  else if (style === "radial") drawRadial(ctx, w, h, notes, amp, phase);
  else drawScope(ctx, w, h, notes, amp, phase);
  ctx.shadowBlur = 0;
}
