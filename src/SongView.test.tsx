import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SongView from "./SongView";
import type { Recording } from "./recordings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const makeRec = (id: string, name: string): Recording => ({
  id,
  name,
  createdAt: 0,
  durationMs: 2000,
  events: [
    { t: 0, kind: "preset", index: 0 },
    { t: 0, kind: "on", note: 60 },
    { t: 1000, kind: "off", note: 60 },
  ],
});

describe("SongView", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it("renders the clip shelf and timeline when recordings exist", () => {
    render(
      <SongView
        recordings={[makeRec("r1", "Intro")]}
        onAddRecordings={vi.fn()}
        onGoToPlay={vi.fn()}
      />,
    );
    expect(screen.getByText("Intro")).toBeDefined();
    expect(screen.getByRole("region", { name: /timeline/i })).toBeDefined();
  });

  it("shows the interstitial when there are no recordings", () => {
    render(<SongView recordings={[]} onAddRecordings={vi.fn()} onGoToPlay={vi.fn()} />);
    expect(screen.getByText(/recorded/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /go record/i })).toBeDefined();
  });

  it("interstitial button calls onGoToPlay", () => {
    const onGoToPlay = vi.fn();
    render(<SongView recordings={[]} onAddRecordings={vi.fn()} onGoToPlay={onGoToPlay} />);
    fireEvent.click(screen.getByRole("button", { name: /go record/i }));
    expect(onGoToPlay).toHaveBeenCalled();
  });

  it("renders the Play and Stop transport buttons", () => {
    render(
      <SongView
        recordings={[makeRec("r1", "Intro")]}
        onAddRecordings={vi.fn()}
        onGoToPlay={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /play arrangement/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /stop/i })).toBeDefined();
  });
});
