import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Timeline from "./Timeline";
import { newArrangement } from "./arrangementStore";
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

describe("Timeline", () => {
  // Use a loosely-typed mock to stay compatible with the vitest version in use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onPlaceClip: any;

  beforeEach(() => {
    onPlaceClip = vi.fn();
  });

  it("renders a track lane", () => {
    const arr = newArrangement();
    render(
      <Timeline
        arrangement={arr}
        recordings={[]}
        isPlaying={false}
        onPlaceClip={onPlaceClip}
      />,
    );
    expect(screen.getByRole("region", { name: /timeline/i })).toBeDefined();
  });

  it("drop event with recordingId calls onPlaceClip with a computed startMs", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline
        arrangement={arr}
        recordings={[makeRec("r1")]}
        isPlaying={false}
        onPlaceClip={onPlaceClip}
      />,
    );

    const lane = screen.getByTestId(`lane-${trackId}`);

    // Mock getBoundingClientRect to control the reference x
    lane.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 60,
      right: 800,
      bottom: 60,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    // fireEvent.drop in jsdom does not expose clientX via Event properties;
    // dispatch a native MouseEvent with clientX so our handler reads it correctly.
    const dropEvent = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
    });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: () => "clip:r1", dropEffect: "copy" },
    });
    lane.dispatchEvent(dropEvent);

    expect(onPlaceClip).toHaveBeenCalledOnce();
    const [calledTrackId, calledRecId, calledStartMs] = onPlaceClip.mock.calls[0];
    expect(calledTrackId).toBe(trackId);
    expect(calledRecId).toBe("r1");
    // 100px at PX_PER_MS=0.04 → 100/0.04 = 2500ms, snapped to 100ms = 2500ms — pins the px→ms→snap pipeline.
    expect(calledStartMs).toBe(2500);
  });

  it("subtracts the lane's left offset and snaps to the 100ms grid (round)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline arrangement={arr} recordings={[makeRec("r1")]} isPlaying={false} onPlaceClip={onPlaceClip} />,
    );
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => ({
      left: 40, top: 0, width: 800, height: 60, right: 840, bottom: 60, x: 40, y: 0, toJSON: () => ({}),
    }));
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 143 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: () => "clip:r1", dropEffect: "copy" },
    });
    lane.dispatchEvent(dropEvent);
    // offset = 143 − 40 = 103px → 103/0.04 = 2575ms → round to nearest 100 = 2600ms
    expect(onPlaceClip.mock.calls[0][2]).toBe(2600);
  });

  it("renders placed clips as labelled blocks", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    const rec = makeRec("r1", 1000);
    const arrWithClip = {
      ...arr,
      tracks: arr.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: [
                {
                  id: "clip-1",
                  recordingId: "r1",
                  startMs: 0,
                  transpose: 0,
                  loopCount: 1,
                },
              ],
            }
          : t,
      ),
    };

    render(
      <Timeline
        arrangement={arrWithClip}
        recordings={[rec]}
        isPlaying={false}
        onPlaceClip={onPlaceClip}
      />,
    );

    expect(screen.getByText("r1")).toBeDefined();
  });

  it("allows dragOver on a lane without throwing", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    render(
      <Timeline
        arrangement={arr}
        recordings={[]}
        isPlaying={false}
        onPlaceClip={onPlaceClip}
      />,
    );

    const lane = screen.getByTestId(`lane-${trackId}`);
    // fireEvent.dragOver should not throw; React calls preventDefault internally
    expect(() => fireEvent.dragOver(lane)).not.toThrow();
  });
});
