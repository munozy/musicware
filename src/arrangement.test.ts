import { describe, it, expect, vi, afterEach } from "vitest";
import {
  flattenArrangement,
  playArrangement,
  pendingNotesAfter,
  clipWindow,
  clipPlayedMs,
  voiceClipPlays,
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

  it("a trimmed clip re-asserts its preset immediately before its note (last preset wins, carried past the trim)", () => {
    const r = rec("r1", 2000, [
      { t: 0, kind: "preset", index: 2 },
      { t: 1000, kind: "on", note: 67 },
      { t: 1500, kind: "off", note: 67 },
    ]);
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 100, trimStartMs: 800, trimEndMs: 2000 })] })]),
      [r],
    );
    // The preset stamp (t=0) is trimmed out of the window, but it is carried forward and
    // re-asserted right before the note it belongs to (at the note's time, not the clip entry).
    expect(ev[0]).toEqual({ t: 300, kind: "preset", index: 2 });
    expect(ev[1]).toMatchObject({ kind: "on", note: 67, t: 300 });
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

  it("a brick is ATOMIC: a note that fires AFTER another brick changed the global preset still gets its OWN instrument", () => {
    // The bug behind the third #3 report: brick A (drum, preset 4) keeps playing while
    // brick B (piano, preset 2) starts. B's note overwrites the global preset; A's LATER
    // note then captured piano instead of drum. The clip announces its preset only ONCE at
    // entry, so nothing re-asserted A's drum before its second hit. Fix: every note is now
    // immediately preceded by its OWN clip's preset, so capture-at-note-on (ADR-0008) always
    // captures the right instrument regardless of what else is sounding.
    const drum = rec("drum", 1200, [
      { t: 0, kind: "preset", index: 4 },
      { t: 0, kind: "on", note: 36 },
      { t: 600, kind: "on", note: 38 }, // the LATER hit — fires after the piano brick starts
    ]);
    const piano = rec("piano", 1000, [
      { t: 0, kind: "preset", index: 2 },
      { t: 0, kind: "on", note: 72 },
      { t: 1000, kind: "off", note: 72 },
    ]);
    const ev = flattenArrangement(
      arr([
        track({ id: "t1", clips: [clip({ recordingId: "drum", startMs: 0 })] }),
        track({ id: "t2", clips: [clip({ recordingId: "piano", startMs: 500 })] }), // piano on at t=500
      ]),
      [drum, piano],
    );
    // The drum's second hit (note 38) lands at t=600, AFTER the piano note set the global to
    // preset 2 at t=500. Its immediately-preceding event must be the DRUM preset (4), not 2.
    const idx38 = ev.findIndex((e) => e.kind === "on" && (e as { note: number }).note === 38);
    expect(idx38).toBeGreaterThan(0);
    expect(ev[idx38 - 1]).toEqual({ t: 600, kind: "preset", index: 4 });
    // And the piano note at t=500 is preceded by the PIANO preset (2) — each brick stays itself.
    const idx72 = ev.findIndex((e) => e.kind === "on" && (e as { note: number }).note === 72);
    expect(ev[idx72 - 1]).toEqual({ t: 500, kind: "preset", index: 2 });
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

describe("clipWindow / clipPlayedMs — the UI/scheduler shared geometry (Slice 5)", () => {
  it("clipWindow: untrimmed clip spans the whole recording", () => {
    expect(clipWindow({ trimStartMs: null, trimEndMs: null }, 2000)).toEqual({ ws: 0, we: 2000, windowLen: 2000 });
  });

  it("clipWindow: trim values clamp into [0, durationMs] and ws never exceeds we", () => {
    expect(clipWindow({ trimStartMs: 500, trimEndMs: 1500 }, 2000)).toEqual({ ws: 500, we: 1500, windowLen: 1000 });
    // over-long trimEnd clamps to durationMs; negative trimStart clamps to 0
    expect(clipWindow({ trimStartMs: -100, trimEndMs: 9999 }, 2000)).toEqual({ ws: 0, we: 2000, windowLen: 2000 });
    // inverted window (start past end) collapses to zero length, not negative
    expect(clipWindow({ trimStartMs: 1800, trimEndMs: 400 }, 2000).windowLen).toBe(0);
  });

  it("clipPlayedMs: trimmed window × loopCount, with loopCount clamped to a whole number >= 1", () => {
    expect(clipPlayedMs({ trimStartMs: null, trimEndMs: null, loopCount: 1 }, 2000)).toBe(2000);
    expect(clipPlayedMs({ trimStartMs: null, trimEndMs: null, loopCount: 3 }, 2000)).toBe(6000);
    expect(clipPlayedMs({ trimStartMs: 500, trimEndMs: 1000, loopCount: 4 }, 2000)).toBe(2000); // 500ms × 4
    expect(clipPlayedMs({ trimStartMs: null, trimEndMs: null, loopCount: 0 }, 2000)).toBe(2000); // clamps to ×1
    expect(clipPlayedMs({ trimStartMs: null, trimEndMs: null, loopCount: 2.9 }, 2000)).toBe(4000); // truncates to ×2
  });

  it("clipPlayedMs equals the scheduler's actual span (last off − first on) for a looped clip", () => {
    // Pin the invariant the width relies on: the block width == what the scheduler lays out.
    const r = rec("r1", 1000, [
      { t: 0, kind: "preset", index: 0 },
      { t: 0, kind: "on", note: 60 },
      { t: 1000, kind: "off", note: 60 },
    ]);
    const ev = flattenArrangement(
      arr([track({ id: "t1", clips: [clip({ recordingId: "r1", startMs: 0, loopCount: 3 })] })]),
      [r],
    );
    const offs = ev.filter((e) => e.kind === "off").map((e) => e.t);
    const lastOff = Math.max(...offs);
    expect(lastOff).toBe(clipPlayedMs({ trimStartMs: null, trimEndMs: null, loopCount: 3 }, 1000)); // 3000
  });
});

describe("voiceClipPlays — the audio (voice) playback pass (ADR-0009)", () => {
  const voiceRec = (id: string, durationMs = 1500, effect: import("./recordings").VoiceEffect = "none"): Recording => ({
    id,
    name: id,
    createdAt: 0,
    durationMs,
    kind: "voice",
    events: [],
    audio: { blobKey: `blob-${id}`, mimeType: "audio/webm", effect },
  });

  it("emits a play descriptor for a voice clip (startMs, effect, loopCount, durationMs, blobKey)", () => {
    const plays = voiceClipPlays(
      arr([track({ id: "t1", clips: [clip({ recordingId: "v1", startMs: 2000, loopCount: 2 })] })]),
      [voiceRec("v1", 1500, "robot")],
    );
    expect(plays).toEqual([
      { recordingId: "v1", blobKey: "blob-v1", effect: "robot", startMs: 2000, loopCount: 2, durationMs: 1500 },
    ]);
  });

  it("voice clips are absent from flattenArrangement (no symbolic events) — the two passes are disjoint", () => {
    const a = arr([track({ id: "t1", clips: [clip({ recordingId: "v1" })] })]);
    expect(flattenArrangement(a, [voiceRec("v1")])).toEqual([]);
    expect(voiceClipPlays(a, [voiceRec("v1")])).toHaveLength(1);
  });

  it("ignores keyboard clips, dangling refs, and per-clip mute", () => {
    const a = arr([
      track({
        id: "t1",
        clips: [
          clip({ recordingId: "kbd" }), // keyboard take — not a voice clip
          clip({ recordingId: "gone" }), // dangling
          clip({ recordingId: "vMuted", muted: true }), // muted voice clip
          clip({ recordingId: "vOk", startMs: 500 }),
        ],
      }),
    ]);
    const plays = voiceClipPlays(a, [cleanNote("kbd"), voiceRec("vMuted"), voiceRec("vOk")]);
    expect(plays.map((p) => p.recordingId)).toEqual(["vOk"]);
  });

  it("respects track mute and solo (solo wins, same gating as flattenArrangement)", () => {
    const recs = [voiceRec("a"), voiceRec("b"), voiceRec("c")];
    const muted = arr([
      track({ id: "t1", clips: [clip({ recordingId: "a" })], muted: true }),
      track({ id: "t2", clips: [clip({ recordingId: "b" })] }),
    ]);
    expect(voiceClipPlays(muted, recs).map((p) => p.recordingId)).toEqual(["b"]); // muted track skipped

    const soloed = arr([
      track({ id: "t1", clips: [clip({ recordingId: "a" })] }),
      track({ id: "t2", clips: [clip({ recordingId: "b" })], soloed: true }),
      track({ id: "t3", clips: [clip({ recordingId: "c" })] }),
    ]);
    expect(voiceClipPlays(soloed, recs).map((p) => p.recordingId)).toEqual(["b"]); // only soloed plays
  });
});
