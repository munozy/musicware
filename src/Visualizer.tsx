import { useEffect, useRef } from "react";
import { noteToFreq } from "./notes";
import { useActiveNotes } from "./useActiveNotes";
import { type VizStyle } from "./visualizerStyles";

/**
 * Live visualizer. Synthesises a glowing animation from the frequencies of the
 * notes currently sounding (live OR replay) — a visual representation driven by
 * the note broadcast, not the audio buffer (audio never crosses to the UI,
 * ADR-0001). Three selectable styles: scope, bars, radial.
 */
function Visualizer({ style }: { style: VizStyle }) {
  const active = useActiveNotes();
  const notesRef = useRef<number[]>([]);
  const styleRef = useRef<VizStyle>(style);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    notesRef.current = [...active];
  }, [active]);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return; // jsdom / unsupported — render nothing

    let raf = 0;
    let phase = 0;
    let amp = 0; // eased global amplitude 0..1
    const BARS = 40;
    const barHeights = new Float32Array(BARS);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 200;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const gradient = (w: number) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "#6ad7ff");
      g.addColorStop(0.5, "#4f86f7");
      g.addColorStop(1, "#b07cff");
      return g;
    };

    const drawScope = (w: number, h: number, notes: number[]) => {
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
      ctx.strokeStyle = gradient(w);
      ctx.stroke();
    };

    const drawBars = (w: number, h: number, notes: number[]) => {
      const gap = 3;
      const bw = (w - gap * (BARS - 1)) / BARS;
      const g = gradient(w);
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
        ctx.roundRect?.(x, h - bh, bw, bh, 3);
        ctx.fill();
      }
    };

    const drawRadial = (w: number, h: number, notes: number[]) => {
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.2;
      const comps = (notes.length ? notes : [45]).map((n) => ({
        lobes: Math.max(2, Math.round(noteToFreq(n) / 60) % 9) + 2,
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
      ctx.strokeStyle = gradient(w);
      ctx.stroke();
    };

    const draw = () => {
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 200;
      const notes = notesRef.current;
      const playing = notes.length > 0;
      amp += ((playing ? 1 : 0.16) - amp) * 0.08;
      phase += playing ? 0.08 : 0.02;

      ctx.clearRect(0, 0, w, h);
      ctx.shadowBlur = playing ? 16 : 6;
      ctx.shadowColor = "#4f86f7";
      if (styleRef.current === "bars") drawBars(w, h, notes);
      else if (styleRef.current === "radial") drawRadial(w, h, notes);
      else drawScope(w, h, notes);
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="viz-canvas" aria-hidden="true" />;
}

export default Visualizer;
