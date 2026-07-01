import { describe, it, expect } from "vitest";
import { normalizeRect, rectsIntersect, marqueeSelection, type Rect } from "./marquee";

describe("normalizeRect", () => {
  it("builds a positive-size rect regardless of drag direction", () => {
    expect(normalizeRect(10, 20, 40, 60)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(normalizeRect(40, 60, 10, 20)).toEqual({ x: 10, y: 20, w: 30, h: 40 }); // dragged up-left
    expect(normalizeRect(40, 20, 10, 60)).toEqual({ x: 10, y: 20, w: 30, h: 40 }); // mixed axes
  });

  it("a zero-drag is a zero-size rect at the point", () => {
    expect(normalizeRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe("rectsIntersect", () => {
  const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
  it("overlapping rects intersect", () => {
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: -5, y: -5, w: 10, h: 10 })).toBe(true);
  });
  it("a rect fully inside another intersects", () => {
    expect(rectsIntersect(a, { x: 2, y: 2, w: 3, h: 3 })).toBe(true);
    expect(rectsIntersect({ x: 2, y: 2, w: 3, h: 3 }, a)).toBe(true);
  });
  it("disjoint rects do not intersect", () => {
    expect(rectsIntersect(a, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 20, w: 5, h: 5 })).toBe(false);
  });
  it("edge-touching (zero overlap) does NOT count as intersecting", () => {
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false); // shares the x=10 edge
    expect(rectsIntersect(a, { x: 0, y: 10, w: 5, h: 5 })).toBe(false); // shares the y=10 edge
  });
});

describe("marqueeSelection", () => {
  // Three clips on stacked rows: c1 top-left, c2 top-right, c3 bottom-left.
  const boxes = [
    { id: "c1", rect: { x: 0, y: 0, w: 40, h: 30 } },
    { id: "c2", rect: { x: 100, y: 0, w: 40, h: 30 } },
    { id: "c3", rect: { x: 0, y: 40, w: 40, h: 30 } },
  ];

  it("returns only the clips the marquee touches, in input order", () => {
    // A rectangle covering the whole left column across both rows → c1 + c3, not c2.
    expect(marqueeSelection({ x: -5, y: -5, w: 60, h: 90 }, boxes)).toEqual(["c1", "c3"]);
  });

  it("a marquee grazing a single clip selects just that one", () => {
    expect(marqueeSelection({ x: 110, y: 10, w: 5, h: 5 }, boxes)).toEqual(["c2"]);
  });

  it("a marquee over empty space selects nothing", () => {
    expect(marqueeSelection({ x: 200, y: 200, w: 50, h: 50 }, boxes)).toEqual([]);
  });

  it("a marquee spanning everything selects all clips", () => {
    expect(marqueeSelection({ x: -10, y: -10, w: 500, h: 500 }, boxes)).toEqual(["c1", "c2", "c3"]);
  });
});
