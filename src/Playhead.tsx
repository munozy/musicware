/**
 * Playhead — the vertical line that tracks playback position (US-23 pulled forward).
 * While playing it advances via requestAnimationFrame from the hook's playStartedAt
 * timestamp; stopped, it parks at `originMs` (the seek / loop-start position). Only this
 * small component re-renders per frame, so the rest of the timeline is untouched.
 *
 * Seek/loop (Slice 7b): playback time t=0 maps to `originMs`, so the visible position is
 * originMs + elapsed. When a loop region of `loopLenMs` is active the elapsed time wraps
 * (elapsed % loopLenMs), so the line snaps back to the region start each cycle.
 */

import { useEffect, useRef, useState } from "react";
import { msToPx, PX_PER_MS, LANE_ORIGIN_PX } from "./timeScale";

/** Left px for a playhead at `posMs` (absolute timeline ms), aligned to the lane origin. Pure — tested. */
export function playheadLeftPx(posMs: number): number {
  return LANE_ORIGIN_PX + msToPx(Math.max(0, posMs), PX_PER_MS);
}

/** Absolute timeline position of the playhead given the run geometry. Pure — tested. */
export function playheadPosMs(originMs: number, elapsedMs: number, loopLenMs: number): number {
  const e = Math.max(0, elapsedMs);
  return originMs + (loopLenMs > 0 ? e % loopLenMs : e);
}

type Props = {
  isPlaying: boolean;
  playStartedAt: number | null;
  /** Timeline ms where playback t=0 maps to (seek / loop start). Parked position when stopped. */
  originMs?: number;
  /** Loop length in ms (0 = no loop) — the playhead wraps within it while playing. */
  loopLenMs?: number;
};

export default function Playhead({ isPlaying, playStartedAt, originMs = 0, loopLenMs = 0 }: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying || playStartedAt == null) {
      setElapsedMs(0);
      return;
    }
    let active = true;
    const tick = () => {
      if (!active) return;
      setElapsedMs(performance.now() - playStartedAt);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, playStartedAt]);

  const posMs = isPlaying ? playheadPosMs(originMs, elapsedMs, loopLenMs) : originMs;

  return (
    <div
      className={`timeline-playhead${isPlaying ? " playing" : ""}`}
      style={{ left: playheadLeftPx(posMs) }}
      aria-hidden="true"
    />
  );
}
