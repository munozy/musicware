import { useEffect, useRef } from "react";
import { useActiveNotes } from "./useActiveNotes";
import { type VizStyle } from "./visualizerStyles";
import { BARS, drawFrame } from "./visualizerDraw";

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
    let lastStyle = styleRef.current;
    const barHeights = new Float32Array(BARS);
    // Respect reduced-motion: no continuous animation (phase frozen) — the shape
    // still updates when the notes change, it just doesn't oscillate (WCAG 2.3.3).
    const reduceMotion =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;

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

    const draw = () => {
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 200;
      const notes = notesRef.current;
      const playing = notes.length > 0;
      // Reset the eased bar heights when (re)entering Bars so it starts clean.
      if (styleRef.current !== lastStyle) {
        if (styleRef.current === "bars") barHeights.fill(0);
        lastStyle = styleRef.current;
      }
      if (reduceMotion) {
        amp = playing ? 1 : 0.16; // snap, no easing; phase stays frozen
      } else {
        amp += ((playing ? 1 : 0.16) - amp) * 0.08;
        phase += playing ? 0.08 : 0.02;
      }
      drawFrame(ctx, styleRef.current, w, h, notes, amp, phase, barHeights);
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
