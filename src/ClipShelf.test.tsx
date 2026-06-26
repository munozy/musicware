import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClipShelf from "./ClipShelf";
import type { Recording } from "./recordings";

const makeRec = (id: string, name: string, durationMs = 3000): Recording => ({
  id,
  name,
  createdAt: 0,
  durationMs,
  events: [],
});

const TRACK_IDS = ["t1", "t2", "t3"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderShelf = (recs: Recording[], onPlaceClip: any = vi.fn()) =>
  render(<ClipShelf recordings={recs} trackIds={TRACK_IDS} onPlaceClip={onPlaceClip} />);

describe("ClipShelf", () => {
  it("renders each recording as a draggable card", () => {
    renderShelf([makeRec("r1", "Composition 1"), makeRec("r2", "Intro riff")]);
    expect(screen.getByText("Composition 1")).toBeDefined();
    expect(screen.getByText("Intro riff")).toBeDefined();
  });

  it("shows the formatted duration for each recording", () => {
    renderShelf([makeRec("r1", "Intro", 75_000)]);
    expect(screen.getByText("1:15")).toBeDefined();
  });

  it("each card has the draggable attribute", () => {
    renderShelf([makeRec("r1", "Comp 1")]);
    const card = screen.getByText("Comp 1").closest("[draggable]");
    expect(card?.getAttribute("draggable")).toBe("true");
  });

  it("onDragStart sets dataTransfer with the recording id", () => {
    renderShelf([makeRec("r1", "Comp 1")]);
    const card = screen.getByText("Comp 1").closest("[draggable]") as HTMLElement;
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "clip:r1");
  });

  it("keyboard: pressing 1/2/3 on a focused card places it on that track at startMs 0", () => {
    const onPlaceClip = vi.fn();
    renderShelf([makeRec("r1", "Comp 1")], onPlaceClip);
    const card = screen.getByText("Comp 1").closest("[draggable]") as HTMLElement;

    fireEvent.keyDown(card, { key: "2" });
    expect(onPlaceClip).toHaveBeenCalledWith("t2", "r1", 0);

    fireEvent.keyDown(card, { key: "Enter" }); // Enter = first track
    expect(onPlaceClip).toHaveBeenLastCalledWith("t1", "r1", 0);

    // announces the placement for screen readers
    expect(screen.getByTestId("shelf-announce").textContent).toMatch(/Placed Comp 1 on track 1/);
  });

  it("shows an empty state when there are no recordings", () => {
    renderShelf([]);
    expect(screen.queryByText(/Composition/)).toBeNull();
  });
});
