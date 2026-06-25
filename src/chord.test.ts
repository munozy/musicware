import { describe, it, expect } from "vitest";
import { detectChord, analyzeChord } from "./chord";

describe("detectChord", () => {
  it("is empty for no notes", () => {
    expect(detectChord([])).toBe("");
  });

  it("names a single note by pitch class", () => {
    expect(detectChord([60])).toBe("C");
    expect(detectChord([66])).toBe("F#");
  });

  it("names major and minor triads", () => {
    expect(detectChord([60, 64, 67])).toBe("C"); // C E G
    expect(detectChord([60, 63, 67])).toBe("Cm"); // C Eb G
    expect(detectChord([57, 60, 64])).toBe("Am"); // A C E
  });

  it("names sevenths", () => {
    expect(detectChord([60, 64, 67, 71])).toBe("Cmaj7");
    expect(detectChord([60, 64, 67, 70])).toBe("C7");
    expect(detectChord([60, 63, 67, 70])).toBe("Cm7");
  });

  it("names dim, aug, and sus", () => {
    expect(detectChord([60, 63, 66])).toBe("Cdim");
    expect(detectChord([60, 64, 68])).toBe("Caug");
    expect(detectChord([60, 65, 67])).toBe("Csus4");
    expect(detectChord([60, 62, 67])).toBe("Csus2");
  });

  it("recognises inversions by pitch-class set", () => {
    // E G C is still a C major triad, voiced over E in the bass.
    expect(detectChord([64, 67, 72])).toBe("C/E");
  });

  it("names a power-chord dyad and a plain interval", () => {
    expect(detectChord([60, 67])).toBe("C5"); // C + G
    expect(detectChord([60, 62])).toBe("C D"); // a 2nd — not a named chord
  });

  it("is octave/duplicate invariant", () => {
    expect(detectChord([60, 64, 67, 72, 76])).toBe("C"); // doubled C and E up an octave
  });

  it("falls back to note names for an unknown cluster", () => {
    expect(detectChord([60, 61, 62])).toBe("C C# D");
  });

  it("lists cluster notes in pitch order (low→high), not chromatic-from-C", () => {
    // A3 A#3 C4 is not a chord; the names must follow the played pitch order.
    expect(detectChord([57, 58, 60])).toBe("A A# C");
    expect(analyzeChord([57, 58, 60])).toEqual({ kind: "cluster", names: ["A", "A#", "C"] });
  });
});

describe("analyzeChord — root + quality (so a chord never looks like one note)", () => {
  it("gives a major triad an explicit 'major' quality, not a bare letter", () => {
    expect(analyzeChord([60, 64, 67])).toEqual({
      kind: "chord",
      root: "C",
      quality: "major",
      sym: "maj",
      bass: null,
    });
  });

  it("labels minor and seventh qualities", () => {
    expect(analyzeChord([57, 60, 64])).toMatchObject({ root: "A", quality: "minor" });
    expect(analyzeChord([60, 64, 67, 71])).toMatchObject({ root: "C", quality: "maj7" });
    expect(analyzeChord([60, 63, 67, 70])).toMatchObject({ root: "C", quality: "min7" });
  });

  it("reports the bass for an inversion", () => {
    expect(analyzeChord([64, 67, 72])).toMatchObject({ root: "C", quality: "major", bass: "E" });
  });

  it("distinguishes a single note (no quality) from a cluster", () => {
    expect(analyzeChord([60])).toEqual({ kind: "single", root: "C" });
    expect(analyzeChord([60, 61, 62])).toEqual({ kind: "cluster", names: ["C", "C#", "D"] });
  });
});
