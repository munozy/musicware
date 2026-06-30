import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Playhead, { playheadLeftPx, playheadPosMs } from "./Playhead";
import { LANE_ORIGIN_PX, PX_PER_MS } from "./timeScale";

describe("playheadLeftPx", () => {
  it("parks at the lane origin at 0ms", () => {
    expect(playheadLeftPx(0)).toBe(LANE_ORIGIN_PX);
  });

  it("advances past the origin by msToPx", () => {
    expect(playheadLeftPx(1000)).toBe(LANE_ORIGIN_PX + 1000 * PX_PER_MS); // 168 + 40 = 208
  });

  it("clamps negative elapsed to the origin", () => {
    expect(playheadLeftPx(-500)).toBe(LANE_ORIGIN_PX);
  });
});

describe("playheadPosMs (seek + loop, Slice 7b)", () => {
  it("with no loop, position is origin + elapsed (seek offsets the start)", () => {
    expect(playheadPosMs(0, 1000, 0)).toBe(1000);
    expect(playheadPosMs(2000, 500, 0)).toBe(2500); // seeked to 2s, 0.5s in
  });

  it("with a loop, elapsed wraps within the loop length around the origin", () => {
    // loop [2s,5s) → origin 2000, len 3000. At 3.5s elapsed it has wrapped once → 0.5s into the region.
    expect(playheadPosMs(2000, 3500, 3000)).toBe(2500);
    expect(playheadPosMs(2000, 3000, 3000)).toBe(2000); // exactly one cycle → back at the start
  });

  it("clamps negative elapsed", () => {
    expect(playheadPosMs(1000, -200, 0)).toBe(1000);
  });
});

describe("Playhead", () => {
  it("renders parked at the lane origin when stopped (no rAF)", () => {
    const { container } = render(<Playhead isPlaying={false} playStartedAt={null} />);
    const el = container.querySelector(".timeline-playhead") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.left).toBe(`${LANE_ORIGIN_PX}px`);
  });

  it("parks at the seek origin when stopped (Slice 7b)", () => {
    const { container } = render(<Playhead isPlaying={false} playStartedAt={null} originMs={1000} />);
    const el = container.querySelector(".timeline-playhead") as HTMLElement;
    expect(el.style.left).toBe(`${playheadLeftPx(1000)}px`);
  });
});
