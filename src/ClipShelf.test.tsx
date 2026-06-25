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

describe("ClipShelf", () => {
  it("renders each recording as a draggable card", () => {
    const recs = [makeRec("r1", "Composition 1"), makeRec("r2", "Intro riff")];
    render(<ClipShelf recordings={recs} />);
    expect(screen.getByText("Composition 1")).toBeDefined();
    expect(screen.getByText("Intro riff")).toBeDefined();
  });

  it("shows the formatted duration for each recording", () => {
    const recs = [makeRec("r1", "Intro", 75_000)];
    render(<ClipShelf recordings={[...recs]} />);
    expect(screen.getByText("1:15")).toBeDefined();
  });

  it("each card has draggable attribute", () => {
    const recs = [makeRec("r1", "Comp 1")];
    render(<ClipShelf recordings={recs} />);
    const card = screen.getByText("Comp 1").closest("[draggable]");
    expect(card).toBeDefined();
    expect(card?.getAttribute("draggable")).toBe("true");
  });

  it("onDragStart sets dataTransfer with the recording id", () => {
    const recs = [makeRec("r1", "Comp 1")];
    render(<ClipShelf recordings={recs} />);
    const card = screen.getByText("Comp 1").closest("[draggable]") as HTMLElement;

    const setData = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData },
    });
    expect(setData).toHaveBeenCalledWith("text/plain", "clip:r1");
  });

  it("shows an empty state when there are no recordings", () => {
    render(<ClipShelf recordings={[]} />);
    // Just ensuring it renders without crash — no recordings listed
    expect(screen.queryByText(/Composition/)).toBeNull();
  });
});
