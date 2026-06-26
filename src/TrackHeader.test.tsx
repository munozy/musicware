import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TrackHeader from "./TrackHeader";
import { TRACK_PALETTE } from "./arrangementStore";
import type { Track } from "./arrangement";

const mkTrack = (over: Partial<Track> = {}): Track => ({
  id: "t1",
  name: "Track 1",
  color: TRACK_PALETTE[0],
  presetIndex: 0,
  clips: [],
  muted: false,
  soloed: false,
  ...over,
});

const ops = () => ({
  onRename: vi.fn(),
  onSetColor: vi.fn(),
  onReorder: vi.fn(),
  onRemove: vi.fn(),
});

const asBtn = (el: HTMLElement) => el as HTMLButtonElement;

describe("TrackHeader", () => {
  it("renames on Enter", () => {
    const o = ops();
    render(<TrackHeader track={mkTrack()} index={0} trackCount={3} {...o} />);
    fireEvent.click(screen.getByRole("button", { name: /rename track/i }));
    const input = screen.getByLabelText("Track name");
    fireEvent.change(input, { target: { value: "Bass" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(o.onRename).toHaveBeenCalledWith("t1", "Bass");
  });

  it("Escape cancels without renaming", () => {
    const o = ops();
    render(<TrackHeader track={mkTrack()} index={0} trackCount={3} {...o} />);
    fireEvent.click(screen.getByRole("button", { name: /rename track/i }));
    const input = screen.getByLabelText("Track name");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(o.onRename).not.toHaveBeenCalled();
  });

  it("colour swatch cycles to the next palette colour", () => {
    const o = ops();
    render(<TrackHeader track={mkTrack({ color: TRACK_PALETTE[0] })} index={0} trackCount={3} {...o} />);
    fireEvent.click(screen.getByRole("button", { name: /change colour/i }));
    expect(o.onSetColor).toHaveBeenCalledWith("t1", TRACK_PALETTE[1]);
  });

  it("reorder buttons call onReorder and are disabled at the ends", () => {
    const o = ops();
    const { rerender } = render(<TrackHeader track={mkTrack()} index={0} trackCount={3} {...o} />);
    expect(asBtn(screen.getByRole("button", { name: /move .* up/i })).disabled).toBe(true); // first → up disabled
    fireEvent.click(screen.getByRole("button", { name: /move .* down/i }));
    expect(o.onReorder).toHaveBeenCalledWith("t1", "down");

    rerender(<TrackHeader track={mkTrack()} index={2} trackCount={3} {...o} />);
    expect(asBtn(screen.getByRole("button", { name: /move .* down/i })).disabled).toBe(true); // last → down disabled
  });

  it("delete requires confirmation, then calls onRemove", () => {
    const o = ops();
    render(<TrackHeader track={mkTrack()} index={1} trackCount={3} {...o} />);
    fireEvent.click(screen.getByRole("button", { name: /^remove track 1$/i }));
    expect(o.onRemove).not.toHaveBeenCalled(); // confirm step shown, not removed yet
    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));
    expect(o.onRemove).toHaveBeenCalledWith("t1");
  });

  it("disables delete when there is only one track", () => {
    const o = ops();
    render(<TrackHeader track={mkTrack()} index={0} trackCount={1} {...o} />);
    expect(asBtn(screen.getByRole("button", { name: /^remove track 1$/i })).disabled).toBe(true);
  });
});
