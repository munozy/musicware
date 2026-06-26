/**
 * Pure px↔ms time-scale helpers for the arrangement Timeline.
 *
 * pxPerMs is the ruler density: how many pixels correspond to one millisecond.
 * A sensible default for the Timeline is PX_PER_SEC / 1000 = 40 / 1000 = 0.04.
 *
 * All functions guard against non-positive scales and negative positions.
 */

/** Timeline layout constants (shared by Timeline + Playhead to avoid a circular import). */
export const PX_PER_SEC = 40;
export const PX_PER_MS = PX_PER_SEC / 1000;
/** Left offset of the lane origin in px (must match the .track-header width in App.css). */
export const LANE_ORIGIN_PX = 168;

/** Convert a pixel x-offset to a timeline position in milliseconds. */
export function pxToMs(px: number, pxPerMs: number): number {
  if (pxPerMs <= 0 || px <= 0) return 0;
  return px / pxPerMs;
}

/** Convert a timeline position in milliseconds to a pixel x-offset. */
export function msToPx(ms: number, pxPerMs: number): number {
  if (pxPerMs <= 0 || ms <= 0) return 0;
  return ms * pxPerMs;
}

/**
 * Round `ms` to the nearest `gridMs` boundary.
 * Returns `ms` unchanged when `gridMs <= 0` (no grid active).
 */
export function snapMs(ms: number, gridMs: number): number {
  if (gridMs <= 0) return ms;
  return Math.round(ms / gridMs) * gridMs;
}
