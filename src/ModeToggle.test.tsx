import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModeToggle from "./ModeToggle";

describe("ModeToggle", () => {
  it("renders Play and Song segments", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={false} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /song/i })).toBeDefined();
  });

  it("marks Play as pressed when mode is play", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={false} />);
    expect(screen.getByRole("button", { name: /play/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /song/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Song as pressed when mode is song", () => {
    render(<ModeToggle mode="song" onChange={vi.fn()} isRecording={false} />);
    expect(screen.getByRole("button", { name: /song/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /play/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking Song fires onChange('song')", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="play" onChange={onChange} isRecording={false} />);
    fireEvent.click(screen.getByRole("button", { name: /song/i }));
    expect(onChange).toHaveBeenCalledWith("song");
  });

  it("clicking Play fires onChange('play')", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="song" onChange={onChange} isRecording={false} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onChange).toHaveBeenCalledWith("play");
  });

  it("Song segment is disabled while recording", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={true} />);
    const songBtn = screen.getByRole("button", { name: /song/i });
    expect(songBtn).toBeDefined();
    expect((songBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocked Song button has a tooltip hint", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={true} />);
    const songBtn = screen.getByRole("button", { name: /song/i });
    expect(songBtn.getAttribute("title")).toBeTruthy();
  });

  it("has a group role with aria-label", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={false} />);
    expect(screen.getByRole("group", { name: /view mode/i })).toBeDefined();
  });

  it("renders the Voice segment and fires onChange('voice') on click", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="play" onChange={onChange} isRecording={false} />);
    const voiceBtn = screen.getByRole("button", { name: /voice/i });
    expect(voiceBtn).toBeDefined();
    fireEvent.click(voiceBtn);
    expect(onChange).toHaveBeenCalledWith("voice");
  });

  it("ArrowRight moves Play → Voice (one step, not straight to Song)", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="play" onChange={onChange} isRecording={false} />);
    fireEvent.keyDown(screen.getByRole("group", { name: /view mode/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("voice");
  });

  it("Voice stays enabled while recording (only Song is blocked)", () => {
    render(<ModeToggle mode="play" onChange={vi.fn()} isRecording={true} />);
    expect((screen.getByRole("button", { name: /voice/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the Video segment and fires onChange('video') on click", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="song" onChange={onChange} isRecording={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(onChange).toHaveBeenCalledWith("video");
  });
});
