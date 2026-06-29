import { describe, it, expect } from "vitest";
import { encodeWav, encodeMp3, songDurationMs, songHasContent } from "./exportSong";
import { newArrangement, addClip } from "./arrangementStore";
import type { Arrangement } from "./arrangement";
import type { Recording } from "./recordings";

// The render+mix path needs a real OfflineAudioContext + Tauri IPC (verified in-app); the
// pure encoders and the duration/has-content helpers are unit-tested here.

const sine = (n: number, sr = 44_100, freq = 440): Float32Array => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  return a;
};

describe("encodeWav", () => {
  it("writes a valid 16-bit PCM WAV header with the right sizes (stereo)", () => {
    const sr = 44_100;
    const frames = 1000;
    const wav = encodeWav([sine(frames), sine(frames)], sr);
    const dv = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);

    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(2); // channels
    expect(dv.getUint32(24, true)).toBe(sr);
    expect(dv.getUint16(34, true)).toBe(16); // bits
    expect(tag(36)).toBe("data");
    const dataSize = frames * 2 /*ch*/ * 2 /*bytes*/;
    expect(dv.getUint32(40, true)).toBe(dataSize);
    expect(wav.length).toBe(44 + dataSize);
  });

  it("clamps out-of-range samples to the 16-bit max", () => {
    const wav = encodeWav([new Float32Array([2, -2])], 44_100); // mono, over-range
    const dv = new DataView(wav.buffer);
    expect(dv.getInt16(44, true)).toBe(0x7fff); // +2 → +full scale
    expect(dv.getInt16(46, true)).toBe(-0x8000); // -2 → -full scale
  });
});

describe("encodeMp3", () => {
  it("produces non-empty MP3 bytes starting with a frame sync (0xFF 0xFB/F2/F3)", () => {
    const mp3 = encodeMp3([sine(4608), sine(4608)], 44_100); // a few 1152-frame blocks
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3[0]).toBe(0xff); // MPEG frame sync
    expect((mp3[1] & 0xe0) === 0xe0).toBe(true);
  });
});

describe("songDurationMs / songHasContent", () => {
  const rec = (id: string): Recording => ({
    id,
    name: id,
    createdAt: 0,
    durationMs: 1000,
    events: [
      { t: 0, kind: "preset", index: 0 },
      { t: 0, kind: "on", note: 60 },
      { t: 800, kind: "off", note: 60 },
    ],
  });

  const withClip = (startMs: number): Arrangement => {
    const a = newArrangement();
    return addClip(a, a.tracks[0].id, "r1", startMs);
  };

  it("songHasContent is false for an empty arrangement, true once a clip is placed", () => {
    expect(songHasContent(newArrangement(), [rec("r1")])).toBe(false);
    expect(songHasContent(withClip(0), [rec("r1")])).toBe(true);
  });

  it("songDurationMs reflects the last event time (clip start + its events)", () => {
    // clip at 2000ms, last off at 800ms into the take → 2800ms
    expect(songDurationMs(withClip(2000), [rec("r1")])).toBe(2800);
  });
});
