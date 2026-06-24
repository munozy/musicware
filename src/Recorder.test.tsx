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
});
