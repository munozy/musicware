import { describe, it, expect, vi, afterEach } from "vitest";
import {
  flattenArrangement,
  playArrangement,
  pendingNotesAfter,
  type Arrangement,
  type Track,
  type ClipInstance,
  type ScheduledEvent,
} from "./arrangement";
import type { Recording, RecEvent } from "./recordings";

// ---- builders -------------------------------------------------------------

const rec = (id: string, durationMs: number, events: RecEvent[]): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs,
  events,
});

const clip = (over: Partial<ClipInstance> & Pick<ClipInstance, "recordingId">): ClipInstance => ({
  id: `clip-${over.recordingId}-${over.startMs ?? 0}`,
  startMs: 0,
  transpose: 0,
  loopCount: 1,
  ...over,
});

const track = (over: Partial<Track> & Pick<Track, "id" | "clips">): Track => ({
  name: over.id,
  color: "#fff",
  presetIndex: 0,
  muted: false,
  soloed: false,
  ...over,
});

const arr = (tracks: Track[]): Arrangement => ({
  id: "a1",
  name: "song",
  createdAt: 0,
  tempoBpm: 120,
  timeSig: [4, 4],
  tracks,
  sections: [],
});

// A clean 1s clip: one note on at 0, off at 1000 (self-contained, like a recorder take).
const cleanNote = (id: string, note = 60) =>
  rec(id, 1000, [
    { t: 0, kind: "preset", index: 0 },
    { t: 0, kind: "on", note },
    { t: 1000, kind: "off", note },
  ]);

/** The core invariant helper: no note_on is left without a matching note_off. */
const stranded = (events: ScheduledEvent[]) => pendingNotesAfter(events);

// ---- flatten: correctness -------------------------------------------------

describe("flattenArrangement — placement & overlap", () => {
  it("two overlapping clips on two tracks BOTH sound in the overlap region", () => {
    const recs = [cleanNote("r1", 60), cleanNote("r2", 64)];
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0 })] }),
      track({ id: "t2", clips: [clip({ recordingId: "r2", startMs: 500 })] }), // overlaps r1 [500,1000)
    ]);
    const ev = flattenArrangement(a, recs);
    // At t=700 (inside both), both 60 and 64 should be sounding.
    const live = pendingNotesAfter(ev, 700);
    expect(live).toEqual(new Set([60, 64]));
    expect(stranded(ev).size).toBe(0);
  });

  it("is sorted by time, with off ordered before on at the same instant", () => {
    // Back-to-back same note across two clips at the seam t=1000.
    const recs = [cleanNote("r1", 60)];
    const a = arr([
      track({
        id: "t1",
        clips: [clip({ recordingId: "r1", startMs: 0 }), clip({ recordingId: "r1", startMs: 1000 })],
      }),
    ]);
    const ev = flattenArrangement(a, recs);
    for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
    const atSeam = ev.filter((e) => e.t === 1000).map((e) => e.kind);
    expect(atSeam.indexOf("off")).toBeLessThan(atSeam.indexOf("on")); // release before re-press
  });
});

describe("flattenArrangement — transpose / loop / trim", () => {
  it("applies transpose to note numbers and clamps to 0..127", () => {
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", transpose: -12 })] })]),
      [cleanNote("r1", 60)],
    );
    expect(ev.filter((e) => e.kind !== "preset").every((e) => "note" in e && e.note === 48)).toBe(true);

    const high = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", transpose: 999 })] })]),
      [cleanNote("r1", 60)],
    );
    expect(high.filter((e) => "note" in e).every((e) => (e as { note: number }).note === 127)).toBe(true);
  });

  it("expands loopCount into N copies at the right offsets, each self-closed", () => {
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", loopCount: 3 })] })]),
      [cleanNote("r1", 60)],
    );
    const ons = ev.filter((e) => e.kind === "on").map((e) => e.t);
    expect(ons).toEqual([0, 1000, 2000]); // three loop iterations, 1s apart
    expect(stranded(ev).size).toBe(0);
  });

  it("trim window suppresses out-of-window events and shifts to clip start", () => {
    const r = rec("r1", 2000, [
      { t: 0, kind: "on", note: 60 },
      { t: 500, kind: "off", note: 60 },
      { t: 1000, kind: "on", note: 67 }, // inside the [800,2000) trim window
      { t: 1500, kind: "off", note: 67 },
    ]);
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 100, trimStartMs: 800, trimEndMs: 2000 })] })]),
      [r],
    );
    // 60 is before the window → gone. 67's on lands at startMs + (1000-800) = 300.
    expect(ev.filter((e) => "note" in e && (e as { note: number }).note === 60)).toHaveLength(0);
    const on67 = ev.find((e) => e.kind === "on");
    expect(on67?.t).toBe(300);
    expect(stranded(ev).size).toBe(0);
  });
});

// ---- the no-stranded-note guarantee (the heart of KA-1) -------------------

describe("flattenArrangement — held-note safety (no stranded notes)", () => {
  it("force-closes a note still held at the END of the clip window", () => {
    // Recording whose note-off was trimmed away / never recorded.
    const r = rec("r1", 1000, [{ t: 0, kind: "on", note: 60 }]); // no off!
    const ev = flattenArrangement(arr([track({ id: "t1", clips: [clip({ recordingId: "r1" })] })]), [r]);
    expect(stranded(ev).size).toBe(0); // a forced off was synthesised at the window end
    const off = ev.find((e) => e.kind === "off");
    expect(off?.t).toBe(1000);
  });

  it("does not let a held note bleed across loop iterations", () => {
    const r = rec("r1", 500, [{ t: 0, kind: "on", note: 60 }]); // held, no off, looped 2x
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", loopCount: 2 })] })]),
      [r],
    );
    // Each loop must close its own note: offs at 500 and 1000; never two simultaneous 60s.
    const offs = ev.filter((e) => e.kind === "off").map((e) => e.t);
    expect(offs).toEqual([500, 1000]);
    expect(pendingNotesAfter(ev, 600)).toEqual(new Set([60])); // 2nd loop's note is live at 600
    expect(stranded(ev).size).toBe(0);
  });
});

// ---- solo / mute / dangling ----------------------------------------------

describe("flattenArrangement — track gating & robustness", () => {
  it("a muted track contributes nothing", () => {
    const a = arr([track({ id: "t1", muted: true, clips: [clip({ recordingId: "r1" })] })]);
    expect(flattenArrangement(a, [cleanNote("r1")])).toHaveLength(0);
  });

  it("a muted clip is skipped (per-brick mute), other clips still play", () => {
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", muted: true }), clip({ recordingId: "r2" })] }),
    ]);
    const ev = flattenArrangement(a, [cleanNote("r1", 60), cleanNote("r2", 64)]);
    const notes = new Set(ev.filter((e) => "note" in e).map((e) => (e as { note: number }).note));
    expect(notes).toEqual(new Set([64])); // r1 muted → only r2 sounds
  });

  it("solo wins: only soloed tracks play, others fall silent", () => {
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0 })] }),
      track({ id: "t2", soloed: true, clips: [clip({ recordingId: "r2", startMs: 0 })] }),
    ]);
    const ev = flattenArrangement(a, [cleanNote("r1", 60), cleanNote("r2", 72)]);
    const notes = new Set(ev.filter((e) => "note" in e).map((e) => (e as { note: number }).note));
    expect(notes).toEqual(new Set([72])); // only the soloed track's note
  });

  it("a dangling clip (missing recording) is skipped, never thrown on", () => {
    const a = arr([track({ id: "t1", clips: [clip({ recordingId: "ghost" }), clip({ recordingId: "r1" })] })]);
    expect(() => flattenArrangement(a, [cleanNote("r1")])).not.toThrow();
    expect(flattenArrangement(a, [cleanNote("r1")]).filter((e) => e.kind === "on")).toHaveLength(1);
  });

  it("every produced event has non-negative time and in-range notes (CONTRACT §4)", () => {
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: -50, transpose: -200 })] })]),
      [cleanNote("r1", 10)],
    );
    expect(ev.every((e) => e.t >= 0)).toBe(true);
    expect(ev.filter((e) => "note" in e).every((e) => (e as { note: number }).note >= 0 && (e as { note: number }).note <= 127)).toBe(true);
  });
});

// ---- the player: mid-stream STOP never strands a note ---------------------

describe("playArrangement — stop safety", () => {
  afterEach(() => vi.useRealTimers());

  it("releases every sounding note when stopped mid-arrangement", () => {
    vi.useFakeTimers();
    const recs = [cleanNote("r1", 60), cleanNote("r2", 64)];
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0 })] }),
      track({ id: "t2", clips: [clip({ recordingId: "r2", startMs: 0 })] }),
    ]);
    const out: { kind: string; note?: number }[] = [];
    const player = playArrangement(flattenArrangement(a, recs), (e) =>
      out.push("note" in e ? { kind: e.kind, note: e.note } : { kind: e.kind }),
    );

    vi.advanceTimersByTime(400); // both notes are on, neither has reached its 1000ms off
    const heldBefore = new Set(
      out.filter((e) => e.kind === "on").map((e) => e.note),
    );
    expect(heldBefore).toEqual(new Set([60, 64]));

    player.stop();
    // After stop, the engine must have received an off for BOTH held notes.
    const offs = out.filter((e) => e.kind === "off").map((e) => e.note);
    expect(new Set(offs)).toEqual(new Set([60, 64]));
    expect(player.stopped).toBe(true);
  });

  it("cancels pending events after stop (no further emits)", () => {
    vi.useFakeTimers();
    const a = arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 800 })] })]);
    const out: string[] = [];
    const player = playArrangement(flattenArrangement(a, [cleanNote("r1")]), (e) => out.push(e.kind));
    player.stop(); // before the clip's 800ms start
    const after = out.length;
    vi.advanceTimersByTime(5000);
    expect(out.length).toBe(after); // nothing fired post-stop
  });

  it("a second stop is a harmless no-op", () => {
    vi.useFakeTimers();
    const a = arr([track({ id: "t1", clips: [clip({ recordingId: "r1" })] })]);
    const out: string[] = [];
    const player = playArrangement(flattenArrangement(a, [cleanNote("r1")]), (e) => out.push(e.kind));
    vi.advanceTimersByTime(200);
    player.stop();
    const n = out.length;
    player.stop();
    expect(out.length).toBe(n);
  });
});

// ---- regressions from the KA-1 adversarial review --------------------------

describe("flattenArrangement — review regressions", () => {
  it("suppresses a dangling off when its on was trimmed away (no same-pitch kill)", () => {
    // r2's note-on is before the trim window; its note-off lands inside it. The bare off
    // must NOT be emitted, else the engine's release-all would cut r1's same-pitch note.
    const r2 = rec("r2", 700, [
      { t: 0, kind: "on", note: 60 },
      { t: 600, kind: "off", note: 60 },
    ]);
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0 })] }), // 60: [0,1000]
      track({ id: "t2", clips: [clip({ recordingId: "r2", startMs: 0, trimStartMs: 300, trimEndMs: 700 })] }),
    ]);
    const ev = flattenArrangement(a, [cleanNote("r1", 60), r2]);
    expect(ev.filter((e) => e.t === 300 && e.kind === "off")).toHaveLength(0); // dangling off suppressed
    expect(pendingNotesAfter(ev, 500)).toEqual(new Set([60])); // r1 not killed early
  });

  it("a trimmed clip still stamps its preset on entry (last preset wins)", () => {
    const r = rec("r1", 2000, [
      { t: 0, kind: "preset", index: 2 },
      { t: 1000, kind: "on", note: 67 },
      { t: 1500, kind: "off", note: 67 },
    ]);
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 100, trimStartMs: 800, trimEndMs: 2000 })] })]),
      [r],
    );
    expect(ev[0]).toEqual({ t: 100, kind: "preset", index: 2 }); // carried to the clip's entry
    expect(ev.find((e) => e.kind === "on")).toMatchObject({ note: 67, t: 300 });
  });

  it("sequential clips of different recordings each announce their own preset", () => {
    const rA = rec("rA", 1000, [
      { t: 0, kind: "preset", index: 1 },
      { t: 0, kind: "on", note: 60 },
      { t: 1000, kind: "off", note: 60 },
    ]);
    const rB = rec("rB", 1000, [
      { t: 0, kind: "preset", index: 3 },
      { t: 0, kind: "on", note: 64 },
      { t: 1000, kind: "off", note: 64 },
    ]);
    const ev = flattenArrangement(
      arr([
        track({ id: "t1", clips: [clip({ recordingId: "rA", startMs: 0 }), clip({ recordingId: "rB", startMs: 1000 })] }),
      ]),
      [rA, rB],
    );
    const presets = ev
      .filter((e) => e.kind === "preset")
      .map((e) => ({ t: e.t, index: (e as { index: number }).index }));
    expect(presets).toEqual([
      { t: 0, index: 1 },
      { t: 1000, index: 3 },
    ]);
  });

  it("DOCUMENTED V1 LIMITATION: overlapping same-pitch clips collapse to the earliest release", () => {
    // Ideal music keeps 60 sounding to 1500; the engine releases ALL voices of 60 at the
    // first off (t=1000), so 60 is silent at 1100. We pin the real (limited) behaviour so
    // it is intentional, not accidental. See flattenArrangement's limitation note + DEBT-027.
    const a = arr([
      track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0 })] }), // 60: [0,1000]
      track({ id: "t2", clips: [clip({ recordingId: "r2", startMs: 500 })] }), // 60: [500,1500]
    ]);
    const ev = flattenArrangement(a, [cleanNote("r1", 60), cleanNote("r2", 60)]);
    expect(pendingNotesAfter(ev, 1100)).toEqual(new Set()); // released early by the engine model
    expect(stranded(ev).size).toBe(0); // but the no-stranded-note gate still holds
  });

  it("loops advance by the trimmed window length, not durationMs", () => {
    const r = rec("r1", 2000, [
      { t: 500, kind: "on", note: 60 },
      { t: 800, kind: "off", note: 60 },
    ]);
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", trimStartMs: 500, trimEndMs: 1000, loopCount: 2 })] })]),
      [r],
    );
    expect(ev.filter((e) => e.kind === "on").map((e) => e.t)).toEqual([0, 500]); // windowLen 500, not durationMs 2000
  });

  it("loopCount edge values: <1 / NaN play exactly once, fractional truncates", () => {
    const onCount = (lc: number) =>
      flattenArrangement(arr([track({ id: "t", clips: [clip({ recordingId: "r1", loopCount: lc })] })]), [cleanNote("r1")]).filter(
        (e) => e.kind === "on",
      ).length;
    expect(onCount(0)).toBe(1);
    expect(onCount(-1)).toBe(1);
    expect(onCount(0.5)).toBe(1);
    expect(onCount(Number.NaN)).toBe(1);
    expect(onCount(2.9)).toBe(2);
  });

  it("keeps each clip's preset immediately before its own note at a shared instant (per-clip timbre)", () => {
    // Three clips starting at t=0 with DIFFERENT presets. The events must interleave
    // per clip (preset → its own on), NOT group all presets then all ons — otherwise
    // every note_on captures whichever preset fired last and they all sound the same
    // (the overlap bug). With ADR-0008 the engine renders each voice by its captured
    // preset, so this ordering is what makes overlapping clips keep their own instrument.
    const recs = [
      rec("a", 1000, [{ t: 0, kind: "preset", index: 1 }, { t: 0, kind: "on", note: 60 }, { t: 1000, kind: "off", note: 60 }]),
      rec("b", 1000, [{ t: 0, kind: "preset", index: 2 }, { t: 0, kind: "on", note: 62 }, { t: 1000, kind: "off", note: 62 }]),
      rec("c", 1000, [{ t: 0, kind: "preset", index: 3 }, { t: 0, kind: "on", note: 64 }, { t: 1000, kind: "off", note: 64 }]),
    ];
    const ev = flattenArrangement(
      arr([
        track({ id: "t1", clips: [clip({ recordingId: "a" })] }),
        track({ id: "t2", clips: [clip({ recordingId: "b" })] }),
        track({ id: "t3", clips: [clip({ recordingId: "c" })] }),
      ]),
      recs,
    );
    const atZero = ev.filter((e) => e.t === 0);
    expect(atZero.map((e) => e.kind)).toEqual(["preset", "on", "preset", "on", "preset", "on"]);
    // Each note's immediately-preceding event is ITS clip's preset.
    expect([
      (atZero[0] as { index: number }).index,
      (atZero[1] as { note: number }).note,
      (atZero[2] as { index: number }).index,
      (atZero[3] as { note: number }).note,
      (atZero[4] as { index: number }).index,
      (atZero[5] as { note: number }).note,
    ]).toEqual([1, 60, 2, 62, 3, 64]);
  });
});

describe("playArrangement — dispatch order", () => {
  afterEach(() => vi.useRealTimers());

  it("dispatches off before on at the same instant (retrigger preserved through the player)", () => {
    vi.useFakeTimers();
    const r = rec("r1", 1000, [
      { t: 0, kind: "on", note: 60 },
      { t: 500, kind: "off", note: 60 },
      { t: 500, kind: "on", note: 60 },
      { t: 1000, kind: "off", note: 60 },
    ]);
    const out: string[] = [];
    playArrangement(
      flattenArrangement(arr([track({ id: "t1", clips: [clip({ recordingId: "r1" })] })]), [r]),
      (e) => out.push(e.kind),
    );
    vi.advanceTimersByTime(500);
    expect(out).toEqual(["on", "off", "on"]); // release before re-press at t=500, via the player
  });
});
