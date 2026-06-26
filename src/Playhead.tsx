/**
 * Playhead — the vertical line that tracks playback position (US-23 pulled forward).
 * While playing it advances via requestAnimationFrame from the hook's playStartedAt
 * timestamp; stopped, it parks at the lane origin (0s). Only this small component
 * re-renders per frame, so the rest of the timeline is untouched.
 */

import { useEffect, useRef, useState } from "react";
import { msToPx, PX_PER_MS, LANE_ORIGIN_PX } from "./timeScale";

/** Left px for a playhead at `elapsedMs`, aligned to the lane origin. Pure — tested. */
export function playheadLeftPx(elapsedMs: number): number {
  return LANE_ORIGIN_PX + msToPx(Math.max(0, elapsedMs), PX_PER_MS);
}

type Props = { isPlaying: boolean; playStartedAt: number | null };

export default function Playhead({ isPlaying, playStartedAt }: Props) {
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

  return (
    <div
      className={`timeline-playhead${isPlaying ? " playing" : ""}`}
      style={{ left: playheadLeftPx(isPlaying ? elapsedMs : 0) }}
      aria-hidden="true"
    />
  );
}
