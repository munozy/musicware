import { describe, it, expect, afterEach, vi } from "vitest";
import { imageIndexAtMs, pickVideoMime } from "./videoExport";

// The canvas/MediaRecorder/AudioContext recording path needs a real webview (verified in-app).
// The pure timing helper + the codec picker are unit-testable.

describe("imageIndexAtMs", () => {
  it("maps a time to the image whose cumulative window contains it; holds the last past the end", () => {
    const d = [2000, 3000, 1000]; // boundaries at 2000, 5000, 6000
    expect(imageIndexAtMs(d, 0)).toBe(0);
    expect(imageIndexAtMs(d, 1999)).toBe(0);
    expect(imageIndexAtMs(d, 2000)).toBe(1);
    expect(imageIndexAtMs(d, 4999)).toBe(1);
    expect(imageIndexAtMs(d, 5000)).toBe(2);
    expect(imageIndexAtMs(d, 5999)).toBe(2);
    expect(imageIndexAtMs(d, 99999)).toBe(2); // beyond total → hold last
    expect(imageIndexAtMs([], 100)).toBe(-1); // no images
  });
});

describe("pickVideoMime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when MediaRecorder is unavailable (e.g. jsdom)", () => {
    expect(pickVideoMime()).toBeNull();
  });

  it("prefers MP4 when supported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (m: string) => m.startsWith("video/mp4"),
    });
    expect(pickVideoMime()?.ext).toBe("mp4");
  });

  it("falls back to WebM when MP4 is unsupported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (m: string) => m.startsWith("video/webm"),
    });
    expect(pickVideoMime()?.ext).toBe("webm");
  });
});
