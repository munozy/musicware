import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Playhead, { playheadLeftPx } from "./Playhead";
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

describe("Playhead", () => {
  it("renders parked at the lane origin when stopped (no rAF)", () => {
    const { container } = render(<Playhead isPlaying={false} playStartedAt={null} />);
    const el = container.querySelector(".timeline-playhead") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.left).toBe(`${LANE_ORIGIN_PX}px`);
  });
});
