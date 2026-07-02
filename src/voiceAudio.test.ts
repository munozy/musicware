import { describe, it, expect } from "vitest";
import { effectPlaybackRate, effectiveVoiceDurationMs } from "./voiceAudio";

// The Web Audio graph (playVoice / loadVoiceBuffer) needs a real AudioContext, which jsdom
// doesn't provide — those are verified in the app. The playback-rate mapping is pure logic
// and underpins both preview and (next) the arrangement clip length, so it's pinned here.
describe("effectPlaybackRate", () => {
  it("chipmunk speeds up, monster slows down, everything else is unchanged", () => {
    expect(effectPlaybackRate("chipmunk")).toBeGreaterThan(1);
    expect(effectPlaybackRate("monster")).toBeLessThan(1);
    expect(effectPlaybackRate("monster")).toBeGreaterThan(0);
    for (const e of ["none", "distortion", "robot", "echo", "telephone", "reverb"] as const) {
      expect(effectPlaybackRate(e)).toBe(1);
    }
  });
});

describe("effectiveVoiceDurationMs (DEBT-034 round 3)", () => {
  it("divides the recorded length by the rate (chipmunk shorter, monster longer)", () => {
    expect(effectiveVoiceDurationMs(1000, "none")).toBe(1000);
    expect(effectiveVoiceDurationMs(1000, "chipmunk")).toBeCloseTo(1000 / 1.6); // 625
    expect(effectiveVoiceDurationMs(1000, "monster")).toBeCloseTo(1000 / 0.65); // ~1538
    expect(effectiveVoiceDurationMs(1000, "echo")).toBe(1000); // non-rate effects unchanged
  });

  it("clamps a negative recorded length to 0", () => {
    expect(effectiveVoiceDurationMs(-50, "chipmunk")).toBe(0);
  });
});
