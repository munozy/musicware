import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import Recorder from "./Recorder";
import { saveRecordings, type Recording } from "./recordings";

const seed = (over: Partial<Recording> = {}): Recording => ({
  id: "r1",
  name: "Composition 1",
  createdAt: 0,
  durationMs: 3000,
  events: [
    { t: 0, kind: "preset", index: 0 },
    { t: 0, kind: "on", note: 60 },
    { t: 1000, kind: "off", note: 60 },
  ],
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Recorder UI", () => {
  it("shows the empty state when there are no recordings", () => {
    render(<Recorder />);
    expect(screen.getByText(/No compositions yet/i)).toBeDefined();
  });

  it("toggles the record button between Record and Stop recording", () => {
    render(<Recorder />);
    const rec = screen.getByLabelText("Record");
    expect(rec.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(rec);
    const stop = screen.getByLabelText("Stop recording");
    expect(stop.getAttribute("aria-pressed")).toBe("true");
  });

  it("lists a saved recording with its duration and controls", () => {
    saveRecordings([seed()]);
    render(<Recorder />);

    expect(screen.getByLabelText("Play Composition 1")).toBeDefined();
    expect(screen.getByLabelText("Delete Composition 1")).toBeDefined();
    expect(screen.getByText("0:03")).toBeDefined();
  });

  it("renames a recording inline", () => {
    saveRecordings([seed()]);
    render(<Recorder />);

    fireEvent.click(screen.getByLabelText("Rename Composition 1"));
    const input = screen.getByLabelText("New name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Intro" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Intro")).toBeDefined();
    expect(screen.queryByText("Composition 1")).toBeNull();
  });

  it("deletes a recording", () => {
    saveRecordings([seed()]);
    render(<Recorder />);

    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(screen.queryByText("Composition 1")).toBeNull();
    expect(screen.getByText(/No compositions yet/i)).toBeDefined();
  });

  it("toggles a row to Stop while playing, then back", () => {
    vi.useFakeTimers();
    saveRecordings([seed()]);
    render(<Recorder />);

    fireEvent.click(screen.getByLabelText("Play Composition 1"));
    expect(screen.getByLabelText("Stop Composition 1")).toBeDefined();

    act(() => vi.advanceTimersByTime(3100)); // past durationMs + end marker
    expect(screen.getByLabelText("Play Composition 1")).toBeDefined();
  });

  it("shows an undo toast after delete and restores the take on Undo", () => {
    saveRecordings([seed()]);
    render(<Recorder />);

    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(screen.queryByLabelText("Play Composition 1")).toBeNull(); // row gone
    expect(screen.getByText(/Deleted/)).toBeDefined(); // toast shown

    fireEvent.click(screen.getByRole("button", { name: /Undo delete/ }));
    expect(screen.getByLabelText("Play Composition 1")).toBeDefined(); // restored
    expect(screen.queryByText(/Deleted/)).toBeNull(); // toast gone
  });

  it("auto-dismisses the undo toast after the window, keeping the take deleted", () => {
    vi.useFakeTimers();
    saveRecordings([seed()]);
    render(<Recorder />);

    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(screen.getByText(/Deleted/)).toBeDefined();

    act(() => vi.advanceTimersByTime(5001));
    expect(screen.queryByText(/Deleted/)).toBeNull();
    expect(screen.queryByLabelText("Play Composition 1")).toBeNull();
  });

  it("restores focus: to Undo after delete, to the name button after rename", () => {
    saveRecordings([seed()]);
    render(<Recorder />);

    // Rename → on commit, focus returns to the name (Rename) button.
    fireEvent.click(screen.getByLabelText("Rename Composition 1"));
    act(() => {
      fireEvent.keyDown(screen.getByLabelText("New name"), { key: "Enter" });
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Rename Composition 1"));

    // Delete → focus moves to the Undo control (not lost on the removed row).
    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Undo delete/ }));
  });
});
