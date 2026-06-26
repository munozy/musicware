import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Timeline from "./Timeline";
import { newArrangement } from "./arrangementStore";
import type { Arrangement } from "./arrangement";
import type { Recording } from "./recordings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const makeRec = (id: string, durationMs = 2000): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs,
  events: [],
});

const LANE_RECT = {
  left: 0, top: 0, width: 800, height: 60, right: 800, bottom: 60, x: 0, y: 0, toJSON: () => ({}),
} as DOMRect;

// An arrangement with one clip on its first track at the given startMs.
const withClip = (startMs: number) => {
  const arr = newArrangement();
  const tid = arr.tracks[0].id;
  const arr2: Arrangement = {
    ...arr,
    tracks: arr.tracks.map((t) =>
      t.id === tid
        ? { ...t, clips: [{ id: "clip-1", recordingId: "r1", startMs, transpose: 0, loopCount: 1 }] }
        : t,
    ),
  };
  return { arr: arr2, tid };
};

describe("Timeline", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onPlaceClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onMoveClip: any;

  beforeEach(() => {
    onPlaceClip = vi.fn();
    onMoveClip = vi.fn();
  });

  it("renders a track lane", () => {
    render(
      <Timeline arrangement={newArrangement()} recordings={[]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    expect(screen.getByRole("region", { name: /timeline/i })).toBeDefined();
  });

  it("drop with a clip: payload calls onPlaceClip with the exact computed startMs", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT);

    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 100 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);

    expect(onPlaceClip).toHaveBeenCalledOnce();
    const [calledTrackId, calledRecId, calledStartMs] = onPlaceClip.mock.calls[0];
    expect(calledTrackId).toBe(trackId);
    expect(calledRecId).toBe("r1");
    // 100px / 0.04 = 2500ms, snapped to 100 = 2500ms — pins the px→ms→snap pipeline.
    expect(calledStartMs).toBe(2500);
  });

  it("subtracts the lane's left offset and snaps to the 100ms grid (round)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => ({ ...LANE_RECT, left: 40, right: 840, x: 40 }) as DOMRect);
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 143 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);
    // (143 − 40) = 103px → 103/0.04 = 2575ms → round to nearest 100 = 2600ms
    expect(onPlaceClip.mock.calls[0][2]).toBe(2600);
  });

  it("clamps a drop past the lane width to the end (no off-the-end placement)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT); // width 800
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 5000 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);
    // clamped to width 800 → 800/0.04 = 20000ms
    expect(onPlaceClip.mock.calls[0][2]).toBe(20000);
  });

  it("drop with a move: payload calls onMoveClip with the grab-offset-corrected startMs", () => {
    const { arr, tid } = withClip(0);
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const lane = screen.getByTestId(`lane-${tid}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT);
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 240 });
    // grabOffset 40 → left edge = 240 − 0 − 40 = 200px → 200/0.04 = 5000ms
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "move:clip-1:40", dropEffect: "move" } });
    lane.dispatchEvent(dropEvent);
    expect(onMoveClip).toHaveBeenCalledWith("clip-1", 5000);
    expect(onPlaceClip).not.toHaveBeenCalled();
  });

  it("a focused placed clip moves with Left/Right arrow keys (keyboard nudge)", () => {
    const { arr } = withClip(1000);
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const block = screen.getByRole("button", { name: /r1 clip/i });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    expect(onMoveClip).toHaveBeenLastCalledWith("clip-1", 1100);
    fireEvent.keyDown(block, { key: "ArrowLeft" });
    expect(onMoveClip).toHaveBeenLastCalledWith("clip-1", 900);
  });

  it("renders placed clips as labelled blocks", () => {
    const { arr } = withClip(0);
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1", 1000)]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    expect(screen.getByText("r1")).toBeDefined();
  });

  it("allows dragOver on a lane without throwing", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline arrangement={arr} recordings={[]} isPlaying={false} onPlaceClip={onPlaceClip} onMoveClip={onMoveClip} />,
    );
    const lane = screen.getByTestId(`lane-${trackId}`);
    expect(() => fireEvent.dragOver(lane)).not.toThrow();
  });
});
