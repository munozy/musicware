/**
 * Marquee (rubber-band) selection geometry — the pure core of Slice 8b.
 *
 * The timeline lets you drag a rectangle over empty lane space to select every clip it
 * touches. The screen math (which pixels the drag covers, where each clip sits) lives in the
 * Timeline component against real laid-out rects; this module holds only the coordinate-free
 * rectangle logic so it can be unit-tested without a DOM.
 *
 * A clip counts as selected when its box INTERSECTS the marquee (touch, not full-containment) —
 * the forgiving desktop behaviour: you don't have to lasso a clip end-to-end to grab it.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/** Build a positive-size rect from two drag corners (either drag direction). */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Axis-aligned overlap test. Touching edges (zero overlap) do NOT count as intersecting. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Ids of the clip boxes the marquee overlaps, in input order. */
export function marqueeSelection(marquee: Rect, boxes: { id: string; rect: Rect }[]): string[] {
  return boxes.filter((b) => rectsIntersect(marquee, b.rect)).map((b) => b.id);
}
