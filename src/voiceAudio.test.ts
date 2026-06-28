import { describe, it, expect } from "vitest";
import { effectPlaybackRate } from "./voiceAudio";

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
