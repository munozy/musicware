import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import VoiceView from "./VoiceView";
import type { Recording } from "./recordings";

const voiceRec = (id: string, name = id): Recording => ({
  id,
  name,
  createdAt: 0,
  durationMs: 1500,
  kind: "voice",
  events: [],
  audio: { blobKey: `k-${id}`, mimeType: "audio/webm", effect: "none" },
});

const baseProps = () => ({
  voiceTakes: [] as Recording[],
  isRecording: false,
  elapsedMs: 0,
  error: null as string | null,
  previewingId: null as string | null,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onPreview: vi.fn(),
  onStopPreview: vi.fn(),
  onSetEffect: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
});

describe("VoiceView", () => {
  let p: ReturnType<typeof baseProps>;
  beforeEach(() => {
    p = baseProps();
  });

  it("shows the empty state when there are no voice takes", () => {
    render(<VoiceView {...p} />);
    expect(screen.getByText(/no voice takes yet/i)).toBeDefined();
  });

  it("Record button reads 'Record voice' and calls onStart; not recording shows no timer", () => {
    render(<VoiceView {...p} />);
    const btn = screen.getByRole("button", { name: /record voice/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false"); // recording state exposed (DEBT-034)
    fireEvent.click(btn);
    expect(p.onStart).toHaveBeenCalledOnce();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("while recording, the button stops and a timer is shown", () => {
    render(<VoiceView {...p} isRecording={true} elapsedMs={2000} />);
    expect(screen.getByRole("timer")).toBeDefined();
    const btn = screen.getByRole("button", { name: /stop recording/i });
    expect(btn.getAttribute("aria-pressed")).toBe("true"); // recording state exposed (DEBT-034)
    fireEvent.click(btn);
    expect(p.onStop).toHaveBeenCalledOnce();
  });

  it("renders a permission error", () => {
    render(<VoiceView {...p} error="Microphone access was blocked." />);
    expect(screen.getByRole("alert").textContent).toMatch(/microphone access/i);
  });

  it("a take row previews on ▶ and stops on ■", () => {
    const rec = voiceRec("v1", "Voice 1");
    const { rerender } = render(<VoiceView {...p} voiceTakes={[rec]} />);
    fireEvent.click(screen.getByRole("button", { name: /play voice 1/i }));
    expect(p.onPreview).toHaveBeenCalledWith(rec);

    rerender(<VoiceView {...p} voiceTakes={[rec]} previewingId="v1" />);
    fireEvent.click(screen.getByRole("button", { name: /stop voice 1/i }));
    expect(p.onStopPreview).toHaveBeenCalledOnce();
  });

  it("changing the effect sets it AND previews it immediately", () => {
    const rec = voiceRec("v1", "Voice 1");
    render(<VoiceView {...p} voiceTakes={[rec]} />);
    fireEvent.change(screen.getByRole("combobox", { name: /effect for voice 1/i }), {
      target: { value: "robot" },
    });
    expect(p.onSetEffect).toHaveBeenCalledWith("v1", "robot");
    expect(p.onPreview).toHaveBeenCalledWith(rec, "robot");
  });

  it("deletes a take", () => {
    render(<VoiceView {...p} voiceTakes={[voiceRec("v1", "Voice 1")]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete voice 1/i }));
    expect(p.onDelete).toHaveBeenCalledWith("v1");
  });

  it("renames a take via click-to-edit + Enter", () => {
    render(<VoiceView {...p} voiceTakes={[voiceRec("v1", "Voice 1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice 1" }));
    const input = screen.getByRole("textbox", { name: /rename voice 1/i });
    fireEvent.change(input, { target: { value: "My laugh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("v1", "My laugh");
  });
});
