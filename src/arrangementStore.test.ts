import { describe, it, expect, beforeEach } from "vitest";
import {
  loadArrangement,
  saveArrangement,
  newArrangement,
  addClip,
  moveClip,
  addTrack,
  renameTrack,
  setTrackColor,
  reorderTrack,
  removeTrack,
  removeClip,
  toggleTrackMuted,
  toggleTrackSoloed,
  toggleClipMuted,
  duplicateClip,
  setClipLoopCount,
  setClipTranspose,
  setClipTrim,
  setClipEffect,
  MAX_TRANSPOSE,
  addSection,
  renameSection,
  moveSection,
  resizeSection,
  removeSection,
  applyTemplate,
  SECTION_TEMPLATES,
  setTempo,
  setBeatsPerBar,
} from "./arrangementStore";

describe("arrangementStore — load/save", () => {
  beforeEach(() => localStorage.clear());

  it("returns a default arrangement when nothing is saved", () => {
    const arr = loadArrangement();
    expect(arr).not.toBeNull();
    expect(arr.tracks).toHaveLength(3);
    expect(arr.tempoBpm).toBe(120);
    expect(arr.timeSig).toEqual([4, 4]);
    expect(arr.sections).toEqual([]);
  });

  it("tolerates corrupt JSON without throwing", () => {
    localStorage.setItem("musicware.arrangements.v1", "{bad json");
    expect(() => loadArrangement()).not.toThrow();
    // Returns a fresh default
    expect(loadArrangement().tracks).toHaveLength(3);
  });

  it("tolerates non-object JSON (array) without throwing", () => {
    localStorage.setItem("musicware.arrangements.v1", "[1,2,3]");
    expect(() => loadArrangement()).not.toThrow();
    expect(loadArrangement().tracks).toHaveLength(3);
  });

  it("round-trips an arrangement through localStorage", () => {
    const arr = newArrangement();
    saveArrangement(arr);
    const loaded = loadArrangement();
    expect(loaded.id).toBe(arr.id);
    expect(loaded.tempoBpm).toBe(120);
    expect(loaded.tracks).toHaveLength(3);
  });

  it("falls back to a fresh default when the stored object has no tracks array (schema drift)", () => {
    localStorage.setItem("musicware.arrangements.v1", JSON.stringify({ id: "x", tempoBpm: 90 }));
    const arr = loadArrangement();
    expect(arr.tracks).toHaveLength(3); // not the malformed object
    expect(arr.tempoBpm).toBe(120);
  });
});

describe("newArrangement", () => {
  it("creates three default tracks with canonical fields and distinct colours", () => {
    const arr = newArrangement();
    expect(arr.tracks).toHaveLength(3);
    arr.tracks.forEach((t, i) => {
      expect(t.name).toBe(`Track ${i + 1}`);
      expect(t.presetIndex).toBe(0);
      expect(t.clips).toEqual([]);
      expect(t.muted).toBe(false);
      expect(t.soloed).toBe(false);
      expect(typeof t.color).toBe("string");
      expect(t.color.length).toBeGreaterThan(0);
    });
    // distinct lane colours
    expect(new Set(arr.tracks.map((t) => t.color)).size).toBe(3);
  });

  it("has default tempo, time sig, and no sections", () => {
    const arr = newArrangement();
    expect(arr.tempoBpm).toBe(120);
    expect(arr.timeSig).toEqual([4, 4]);
    expect(arr.sections).toEqual([]);
  });

  it("has a non-empty id and a createdAt timestamp", () => {
    const arr = newArrangement();
    expect(typeof arr.id).toBe("string");
    expect(arr.id.length).toBeGreaterThan(0);
    expect(typeof arr.createdAt).toBe("number");
    expect(arr.createdAt).toBeGreaterThan(0);
  });

  it("produces unique ids across calls", () => {
    const a = newArrangement();
    const b = newArrangement();
    expect(a.id).not.toBe(b.id);
  });
});

describe("addClip", () => {
  it("appends a ClipInstance referencing the recording id (not a copy of events)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    const next = addClip(arr, trackId, "rec-abc", 2000);

    expect(next.tracks[0].clips).toHaveLength(1);
    const c = next.tracks[0].clips[0];
    expect(c.recordingId).toBe("rec-abc");
    expect(c.startMs).toBe(2000);
    expect(c.transpose).toBe(0);
    expect(c.loopCount).toBe(1);
  });

  it("is immutable — the original arrangement is unchanged", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    addClip(arr, trackId, "rec-abc", 0);
    expect(arr.tracks[0].clips).toHaveLength(0);
  });

  it("assigns a unique id to the new clip", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    const n1 = addClip(arr, trackId, "r1", 0);
    const n2 = addClip(n1, trackId, "r2", 500);
    expect(n2.tracks[0].clips[0].id).not.toBe(n2.tracks[0].clips[1].id);
  });

  it("is dangling-safe — unknown trackId returns an unchanged arrangement", () => {
    const arr = newArrangement();
    const next = addClip(arr, "no-such-track", "rec-x", 0);
    expect(next.tracks[0].clips).toHaveLength(0);
  });

  it("multiple addClip calls accumulate clips on the track", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    const n1 = addClip(arr, trackId, "r1", 0);
    const n2 = addClip(n1, trackId, "r2", 1000);
    expect(n2.tracks[0].clips).toHaveLength(2);
    expect(n2.tracks[0].clips[0].recordingId).toBe("r1");
    expect(n2.tracks[0].clips[1].recordingId).toBe("r2");
  });
});

describe("moveClip", () => {
  const seed = () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    const withClip = addClip(arr, trackId, "rec-1", 1000);
    return { arr: withClip, clipId: withClip.tracks[0].clips[0].id };
  };

  it("moves a clip to a new startMs (finds it across tracks)", () => {
    const { arr, clipId } = seed();
    const next = moveClip(arr, clipId, 4000);
    expect(next.tracks[0].clips[0].startMs).toBe(4000);
  });

  it("clamps a negative target to 0", () => {
    const { arr, clipId } = seed();
    expect(moveClip(arr, clipId, -500).tracks[0].clips[0].startMs).toBe(0);
  });

  it("is immutable — the original arrangement is unchanged", () => {
    const { arr, clipId } = seed();
    moveClip(arr, clipId, 9999);
    expect(arr.tracks[0].clips[0].startMs).toBe(1000);
  });

  it("returns the arrangement unchanged for an unknown clipId", () => {
    const { arr } = seed();
    expect(moveClip(arr, "no-such-clip", 4000)).toBe(arr);
  });
});

describe("track management", () => {
  it("addTrack appends a track with the next name and an empty clip list (immutable)", () => {
    const arr = newArrangement(); // 3 tracks
    const next = addTrack(arr);
    expect(next.tracks).toHaveLength(4);
    expect(next.tracks[3].name).toBe("Track 4");
    expect(next.tracks[3].clips).toEqual([]);
    expect(arr.tracks).toHaveLength(3); // original unchanged
  });

  it("renameTrack trims the name; ignores empty/whitespace and unknown ids", () => {
    const arr = newArrangement();
    const id = arr.tracks[0].id;
    expect(renameTrack(arr, id, "  Bass  ").tracks[0].name).toBe("Bass");
    expect(renameTrack(arr, id, "   ")).toBe(arr); // empty → unchanged (same ref)
    expect(renameTrack(arr, "nope", "X")).toBe(arr); // unknown → unchanged
  });

  it("setTrackColor sets the colour; unknown id unchanged", () => {
    const arr = newArrangement();
    const id = arr.tracks[1].id;
    expect(setTrackColor(arr, id, "#abcdef").tracks[1].color).toBe("#abcdef");
    expect(setTrackColor(arr, "nope", "#abcdef")).toBe(arr);
  });

  it("reorderTrack swaps with the neighbour and clamps at the ends", () => {
    const arr = newArrangement();
    const [a, b, c] = arr.tracks.map((t) => t.id);
    expect(reorderTrack(arr, a, "down").tracks.map((t) => t.id)).toEqual([b, a, c]);
    expect(reorderTrack(arr, c, "up").tracks.map((t) => t.id)).toEqual([a, c, b]);
    expect(reorderTrack(arr, a, "up")).toBe(arr); // already first
    expect(reorderTrack(arr, c, "down")).toBe(arr); // already last
    expect(reorderTrack(arr, "nope", "up")).toBe(arr);
  });

  it("removeTrack removes a track but refuses to remove the last one", () => {
    const arr = newArrangement(); // 3 tracks
    const id = arr.tracks[0].id;
    const removed = removeTrack(arr, id);
    expect(removed.tracks).toHaveLength(2);
    expect(removed.tracks.some((t) => t.id === id)).toBe(false);
    expect(arr.tracks).toHaveLength(3); // immutable

    const single = { ...arr, tracks: [arr.tracks[0]] };
    expect(removeTrack(single, single.tracks[0].id)).toBe(single); // refuses the last track
    expect(removeTrack(arr, "nope")).toBe(arr); // unknown id unchanged
  });
});

describe("removeClip", () => {
  const seed = () => {
    const arr = newArrangement();
    const tid = arr.tracks[0].id;
    const withClip = addClip(arr, tid, "rec-1", 0);
    return { arr: withClip, clipId: withClip.tracks[0].clips[0].id };
  };

  it("removes the clip from its track (immutable)", () => {
    const { arr, clipId } = seed();
    const next = removeClip(arr, clipId);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(arr.tracks[0].clips).toHaveLength(1); // original unchanged
  });

  it("returns the arrangement unchanged for an unknown clipId", () => {
    const { arr } = seed();
    expect(removeClip(arr, "no-such-clip")).toBe(arr);
  });
});

describe("track mute / solo toggles", () => {
  it("toggleTrackMuted flips muted (immutable); unknown id unchanged", () => {
    const arr = newArrangement();
    const id = arr.tracks[0].id;
    expect(arr.tracks[0].muted).toBe(false);
    const muted = toggleTrackMuted(arr, id);
    expect(muted.tracks[0].muted).toBe(true);
    expect(arr.tracks[0].muted).toBe(false); // original unchanged
    expect(toggleTrackMuted(muted, id).tracks[0].muted).toBe(false); // toggles back
    expect(toggleTrackMuted(arr, "nope")).toBe(arr);
  });

  it("toggleTrackSoloed flips soloed; unknown id unchanged", () => {
    const arr = newArrangement();
    const id = arr.tracks[1].id;
    expect(toggleTrackSoloed(arr, id).tracks[1].soloed).toBe(true);
    expect(toggleTrackSoloed(arr, "nope")).toBe(arr);
  });

  it("toggleClipMuted flips a single clip's muted flag (immutable); unknown id unchanged", () => {
    const base = newArrangement();
    const tid = base.tracks[0].id;
    const arr = addClip(base, tid, "rec-1", 0);
    const clipId = arr.tracks[0].clips[0].id;
    const muted = toggleClipMuted(arr, clipId);
    expect(muted.tracks[0].clips[0].muted).toBe(true);
    expect(arr.tracks[0].clips[0].muted).toBeFalsy(); // original unchanged
    expect(toggleClipMuted(muted, clipId).tracks[0].clips[0].muted).toBe(false); // toggles back
    expect(toggleClipMuted(arr, "nope")).toBe(arr);
  });
});

describe("clip editing — duplicate / loop / transpose (Slice 5)", () => {
  const seed = (extra: Partial<import("./arrangement").ClipInstance> = {}) => {
    const base = newArrangement();
    const tid = base.tracks[0].id;
    let arr = addClip(base, tid, "rec-1", 1000);
    const clipId = arr.tracks[0].clips[0].id;
    if (Object.keys(extra).length) {
      arr = { ...arr, tracks: arr.tracks.map((t) => (t.id === tid ? { ...t, clips: [{ ...t.clips[0], ...extra }] } : t)) };
    }
    return { arr, clipId, tid };
  };

  describe("duplicateClip", () => {
    it("inserts a copy with a fresh id right after the original on the same track", () => {
      const { arr, clipId } = seed();
      const next = duplicateClip(arr, clipId, 3000);
      expect(next.tracks[0].clips).toHaveLength(2);
      const [orig, copy] = next.tracks[0].clips;
      expect(copy.id).not.toBe(orig.id); // fresh id
      expect(copy.recordingId).toBe("rec-1");
      expect(copy.startMs).toBe(3000); // placed where the caller asked (clamped >= 0)
      expect(orig.startMs).toBe(1000); // original untouched
    });

    it("preserves the original's edits (transpose / loop / trim / mute) on the copy", () => {
      const { arr, clipId } = seed({ transpose: 5, loopCount: 3, trimStartMs: 200, trimEndMs: 800, muted: true });
      const copy = duplicateClip(arr, clipId, 0).tracks[0].clips[1];
      expect(copy).toMatchObject({ transpose: 5, loopCount: 3, trimStartMs: 200, trimEndMs: 800, muted: true });
    });

    it("clamps a negative target to 0; is immutable; unknown id → unchanged (same ref)", () => {
      const { arr, clipId } = seed();
      expect(duplicateClip(arr, clipId, -500).tracks[0].clips[1].startMs).toBe(0);
      expect(arr.tracks[0].clips).toHaveLength(1); // original arrangement unchanged
      expect(duplicateClip(arr, "no-such-clip", 0)).toBe(arr);
    });
  });

  describe("setClipLoopCount", () => {
    it("sets a whole loop count >= 1; clamps <1 / NaN to 1; truncates fractional", () => {
      const { arr, clipId } = seed();
      expect(setClipLoopCount(arr, clipId, 4).tracks[0].clips[0].loopCount).toBe(4);
      expect(setClipLoopCount(arr, clipId, 0).tracks[0].clips[0].loopCount).toBe(1);
      expect(setClipLoopCount(arr, clipId, -3).tracks[0].clips[0].loopCount).toBe(1);
      expect(setClipLoopCount(arr, clipId, Number.NaN).tracks[0].clips[0].loopCount).toBe(1);
      expect(setClipLoopCount(arr, clipId, 2.9).tracks[0].clips[0].loopCount).toBe(2);
    });
    it("is immutable; unknown id → unchanged (same ref)", () => {
      const { arr, clipId } = seed();
      setClipLoopCount(arr, clipId, 9);
      expect(arr.tracks[0].clips[0].loopCount).toBe(1);
      expect(setClipLoopCount(arr, "nope", 2)).toBe(arr);
    });
  });

  describe("setClipTranspose", () => {
    it("sets semitones; clamps to ±MAX_TRANSPOSE; truncates fractional; NaN → 0", () => {
      const { arr, clipId } = seed();
      expect(setClipTranspose(arr, clipId, 7).tracks[0].clips[0].transpose).toBe(7);
      expect(setClipTranspose(arr, clipId, -7).tracks[0].clips[0].transpose).toBe(-7);
      expect(setClipTranspose(arr, clipId, 999).tracks[0].clips[0].transpose).toBe(MAX_TRANSPOSE);
      expect(setClipTranspose(arr, clipId, -999).tracks[0].clips[0].transpose).toBe(-MAX_TRANSPOSE);
      expect(setClipTranspose(arr, clipId, 3.9).tracks[0].clips[0].transpose).toBe(3);
      expect(setClipTranspose(arr, clipId, Number.NaN).tracks[0].clips[0].transpose).toBe(0);
    });
    it("is immutable; unknown id → unchanged (same ref)", () => {
      const { arr, clipId } = seed();
      setClipTranspose(arr, clipId, 5);
      expect(arr.tracks[0].clips[0].transpose).toBe(0);
      expect(setClipTranspose(arr, "nope", 5)).toBe(arr);
    });
  });

  describe("setClipTrim", () => {
    it("sets trimEndMs (right-edge trim) leaving startMs untouched", () => {
      const { arr, clipId } = seed(); // startMs 1000
      const c = setClipTrim(arr, clipId, { trimEndMs: 1800 }).tracks[0].clips[0];
      expect(c.trimEndMs).toBe(1800);
      expect(c.startMs).toBe(1000);
    });

    it("sets trimStartMs AND a shifted startMs together (left-edge trim keeps content in place)", () => {
      const { arr, clipId } = seed(); // startMs 1000
      const c = setClipTrim(arr, clipId, { trimStartMs: 300, startMs: 1300 }).tracks[0].clips[0];
      expect(c.trimStartMs).toBe(300);
      expect(c.startMs).toBe(1300);
    });

    it("rounds and clamps each provided field to >= 0; only patches the fields given", () => {
      const { arr, clipId } = seed();
      const c = setClipTrim(arr, clipId, { trimStartMs: -50, trimEndMs: 1499.6 }).tracks[0].clips[0];
      expect(c.trimStartMs).toBe(0);
      expect(c.trimEndMs).toBe(1500);
      expect(c.transpose).toBe(0); // untouched
    });

    it("is immutable; unknown id → unchanged (same ref)", () => {
      const { arr, clipId } = seed();
      setClipTrim(arr, clipId, { trimEndMs: 1000 });
      expect(arr.tracks[0].clips[0].trimEndMs).toBeUndefined();
      expect(setClipTrim(arr, "nope", { trimEndMs: 1000 })).toBe(arr);
    });
  });

  describe("setClipEffect", () => {
    it("sets a clip's per-instance voice effect; immutable; unknown id → unchanged", () => {
      const { arr, clipId } = seed();
      expect(setClipEffect(arr, clipId, "robot").tracks[0].clips[0].effect).toBe("robot");
      expect(arr.tracks[0].clips[0].effect).toBeUndefined(); // original untouched
      expect(setClipEffect(arr, "nope", "echo")).toBe(arr);
    });
  });
});

describe("song structure — sections + templates (Slice 6)", () => {
  it("addSection appends an auto-named, coloured section (start/end clamped); immutable", () => {
    const arr = newArrangement();
    const next = addSection(arr, -100, 4000);
    expect(arr.sections).toEqual([]); // original untouched
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0]).toMatchObject({ name: "Section 1", startMs: 0, endMs: 4000 });
    expect(typeof next.sections[0].color).toBe("string");
    expect(addSection(next, 5000, 6000).sections[1].name).toBe("Section 2");
  });

  it("renameSection trims; ignores blank + unknown id", () => {
    const a = addSection(newArrangement(), 0, 4000);
    const id = a.sections[0].id;
    expect(renameSection(a, id, "  Chorus ").sections[0].name).toBe("Chorus");
    expect(renameSection(a, id, "  ")).toBe(a);
    expect(renameSection(a, "nope", "X")).toBe(a);
  });

  it("moveSection shifts the start (clamped >= 0), preserving length", () => {
    const a = addSection(newArrangement(), 1000, 3000); // length 2000
    const id = a.sections[0].id;
    const moved = moveSection(a, id, 5000).sections[0];
    expect(moved).toMatchObject({ startMs: 5000, endMs: 7000 });
    expect(moveSection(a, id, -500).sections[0]).toMatchObject({ startMs: 0, endMs: 2000 });
  });

  it("resizeSection sets the end (kept past the start); removeSection drops it", () => {
    const a = addSection(newArrangement(), 1000, 3000);
    const id = a.sections[0].id;
    expect(resizeSection(a, id, 6000).sections[0].endMs).toBe(6000);
    expect(resizeSection(a, id, 500).sections[0].endMs).toBeGreaterThan(1000); // can't cross the start
    expect(removeSection(a, id).sections).toEqual([]);
  });

  it("applyTemplate lays the genre parts contiguously across totalMs; unknown key → unchanged", () => {
    const a = addSection(newArrangement(), 0, 4000); // pre-existing section is replaced
    const out = applyTemplate(a, "electronic", 10_000);
    const parts = SECTION_TEMPLATES.electronic.parts;
    expect(out.sections).toHaveLength(parts.length);
    expect(out.sections[0].name).toBe("Intro");
    expect(out.sections[0].startMs).toBe(0);
    expect(out.sections[out.sections.length - 1].endMs).toBe(10_000); // last absorbs rounding → exactly fills
    // contiguous: each section starts where the previous ended
    for (let i = 1; i < out.sections.length; i++) {
      expect(out.sections[i].startMs).toBe(out.sections[i - 1].endMs);
    }
    expect(applyTemplate(a, "nope", 10_000)).toBe(a);
  });
});

describe("transport — tempo + time signature (Slice 7)", () => {
  it("setTempo clamps to 40–300 and rounds; doesn't touch clips", () => {
    const a = addClip(newArrangement(), newArrangement().tracks[0].id, "r1", 1000);
    expect(setTempo(a, 140).tempoBpm).toBe(140);
    expect(setTempo(a, 5).tempoBpm).toBe(40);
    expect(setTempo(a, 9999).tempoBpm).toBe(300);
    expect(setTempo(a, 128.6).tempoBpm).toBe(129);
    // US-25: tempo change must not move placed clips
    const before = a.tracks[0].clips[0]?.startMs;
    const after = setTempo(a, 200).tracks[0].clips[0]?.startMs;
    expect(after).toBe(before);
  });

  it("setBeatsPerBar clamps to 1–12 and keeps the /4 denominator", () => {
    const a = newArrangement();
    expect(setBeatsPerBar(a, 3).timeSig).toEqual([3, 4]);
    expect(setBeatsPerBar(a, 0).timeSig).toEqual([1, 4]);
    expect(setBeatsPerBar(a, 99).timeSig).toEqual([12, 4]);
  });
});
