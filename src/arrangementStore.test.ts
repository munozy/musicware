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
