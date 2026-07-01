import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SongTransport from "./SongTransport";

const baseProps = () => ({
  isPlaying: false,
  onPlay: vi.fn(),
  onStop: vi.fn(),
  recordings: [],
  tempoBpm: 120,
  beatsPerBar: 4,
  snap: "beat" as const,
  onSetTempo: vi.fn(),
  onSetBeatsPerBar: vi.fn(),
  onSetSnap: vi.fn(),
  seekMs: 0,
  loopRegion: null,
  loopEnabled: false,
  onToggleLoop: vi.fn(),
  onClearSeek: vi.fn(),
  onClearLoop: vi.fn(),
});

describe("SongTransport — grid controls (Slice 7)", () => {
  let p: ReturnType<typeof baseProps>;
  beforeEach(() => {
    p = baseProps();
  });

  it("Play/Stop fire and reflect isPlaying", () => {
    const { rerender } = render(<SongTransport {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /play arrangement/i }));
    expect(p.onPlay).toHaveBeenCalledWith([]);
    rerender(<SongTransport {...p} isPlaying={true} />);
    expect((screen.getByRole("button", { name: /play arrangement/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("BPM input fires onSetTempo", () => {
    render(<SongTransport {...p} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /tempo in bpm/i }), { target: { value: "140" } });
    expect(p.onSetTempo).toHaveBeenCalledWith(140);
  });

  it("beats-per-bar fires onSetBeatsPerBar; snap fires onSetSnap", () => {
    render(<SongTransport {...p} />);
    fireEvent.change(screen.getByRole("combobox", { name: /beats per bar/i }), { target: { value: "3" } });
    expect(p.onSetBeatsPerBar).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByRole("combobox", { name: /snap to grid/i }), { target: { value: "bar" } });
    expect(p.onSetSnap).toHaveBeenCalledWith("bar");
  });
});
