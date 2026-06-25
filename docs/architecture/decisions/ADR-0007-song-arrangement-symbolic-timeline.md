# ADR-0007 — Song Arrangement as a symbolic multi-track timeline over the existing engine

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Proposed
- **Date:** 2026-06-25
- **Deciders:** Architecture (`moonozy-architect`) + developer (munozy)

## Context

The next learning step for musicware is **Song Arrangement**: a beginner arranges a complete song by placing
their saved keyboard compositions (Recordings) onto a **multi-track timeline**, then plays the whole thing back
(GarageBand's region/arrange view, scaled down). This is the first feature that asks "play *many* saved things
together, positioned in time" rather than "play one live note."

The as-built reality this must live inside (do **not** re-architect it):

- **A "clip" already exists, and it is a Recording — symbolic, not audio** (ADR-0002). `src/recordings.ts`:
  `Recording { id, name, createdAt, durationMs, events: RecEvent[] }`, where
  `RecEvent = SynthEvent & { t: ms }` and `SynthEvent = {kind:"on"|"off", note} | {kind:"preset", index}`.
  Recordings persist to `localStorage` (`musicware.recordings.v1`). Replay re-dispatches events through the
  `src/synth.ts` choke point (`emit`) on a `setTimeout` schedule. The UI owns this state; the engine never
  knows recording/replay exists.
- **The engine is one global instrument** (ADR-0001/0003, `src-tauri/src/audio.rs`): a single lock-free SPSC
  ring buffer of `NoteEvent { NoteOn{note} | NoteOff{note} }` → one fixed **16-voice pool** → per-voice ADSR →
  waveform → a constant `MASTER_GAIN = 1/VOICE_COUNT` → a single post-render `level × VOLUME_GAIN_MAX` +
  hard-limiter master stage. There is **no per-track mixing, no pan, no effects/DSP graph, no buses**. The
  real-time callback must never allocate or lock (`assert_no_alloc`).
- **Preset (timbre) is GLOBAL, not per-note.** It is a single `AtomicU8` read once per block; the *waveform*
  applies live to every sounding voice, and each voice only captures its *envelope* at note-on. The ring
  buffer carries no preset — `set_preset` is a separate atomic. So "this clip is a Piano, that clip is Drums,
  playing at the same instant" is **not expressible today**: at any moment the whole engine has exactly one
  waveform.
- This is a **learning DAW** whose comparison class is "GarageBand already works" (ADR-0001). Arrangement must
  be cheap to build, reuse the hard-won engine, and not spend its real-time-safety proofs on a sequencing
  feature that needs none of them — exactly the discipline ADR-0002 used for the recorder.

The forces, then: we want a timeline of many positioned clips with eventual per-track volume/pan/effects, but
the engine is a single global monophonic-timbre mixer-less instrument, and its value is precisely that it is
small, proven, and alloc-free. We must model the *sequencing* concern where it is cheap (the UI, like the
recorder) and treat the *mixing/timbre* concern as a **separate, phased growth of the engine** — not a
prerequisite for V1.

## Decision

### V1 — A SYMBOLIC arrangement sequencer that REUSES the existing engine

An **Arrangement** is **tracks of ClipInstances**, each `ClipInstance` *referencing a Recording by id* with a
timeline **start time**, an optional **transpose** (semitones), and a **loop count**. A control-rate
**scheduler** (the **Arrangement transport**) merges all active clips' events into a single time-ordered
stream of `note_on` / `note_off` / `set_preset` and feeds the **existing** ring buffer **ahead of the
playhead**, through the **existing `src/synth.ts` `emit` choke point**. This is the recorder's replay
mechanism (ADR-0002) generalised from one take to N positioned, transposed, looped takes.

- **Scheduler lives in the UI/TypeScript for V1** (sub-decision below). It is a *generalised replay engine*:
  it flattens the arrangement into an absolute-time event list and dispatches via `emit()` (which does NOT
  re-tap the recorder sink, so arranging/playing never records itself). It reuses the existing note broadcast,
  so the keyboard, chord read-out, and visualizer light up during arrangement playback for free (ADR-0004).
- **The Rust engine is UNCHANGED for V1.** No new commands, no ring-buffer change, no real-time-thread change.
  Arrangement is a **strangler-fig leaf** on the same dispatch boundary the recorder hangs off (ADR-0002) —
  it adds capability without migrating the engine.
- **Transpose** is applied by the scheduler when it flattens: `note' = clamp(note + semitones, 0, 127)`
  per `on`/`off`. Pitch math only — no engine change. (Drums clips: note is a pitch *class* selector;
  transpose shifts which drum — accepted, documented; a per-track "no-transpose" flag is forward-looking.)
- **Loop** is unrolled by the scheduler: a clip with `loopCount = n` emits its event list `n` times at
  `start + k·windowLen`, where `windowLen = trimEnd − trimStart` (`= durationMs` when the clip is untrimmed)
  — so trimmed loops abut instead of overlapping. (`loopCount = 1` = play once; a forward-looking "loop to
  region end" is V2.) Implemented in `src/arrangement.ts` `flattenClip`; pinned by the KA-1 gate tests.
- **Persistence** mirrors recordings: arrangements are plain versioned JSON in `localStorage`
  (`musicware.arrangements.v1`), the in-memory list is the source of truth. ClipInstances store a Recording
  **id**, never a copy — one source of truth for the take's events.

#### The per-track-instrument tension (the V1 honest limitation)

A track should map to one instrument (Drum track, Piano track, Bass track). But the engine has **one global
preset**, and the ring buffer carries no per-note timbre. V1 cannot make a Piano clip and a Drums clip sound
*simultaneously* with their own timbres.

**V1 recommendation — "last preset wins", time-sliced, honestly surfaced:**
1. **Each Recording already self-stamps its preset** at `t=0` (ADR-0002). The scheduler emits that clip's
   `set_preset` when the clip *enters*. If only one track's clips overlap at a time, every clip plays with the
   right timbre — the common beginner case (verse on piano, then a drum fill).
2. When clips of **different timbres overlap**, the engine's single live waveform means the *last* `set_preset`
   wins for the overlap window (held notes keep their captured envelope; only the waveform is global — see
   ADR-0006). The UI must **surface this** ("tracks with different instruments can't play at the exact same
   time yet") rather than silently mis-render. A **Track.presetIndex** field is introduced now in the data
   model (so a track declares its instrument) but in V1 it is advisory/validation only — the engine cannot
   honour two at once.

This is the deliberately-accepted V1 cost, and the single thing V2 must fix. It is the same shape of honest
limitation ADR-0002 accepted (preset buttons don't re-highlight on replay): the *content* model is correct;
the *engine* can't yet render it fully.

### V2+ — PHASED growth of the engine into a per-track mix / DSP graph

Per-track volume/pan/effects and a pro-effects suite require the engine to **grow a mix/DSP graph**:
`per-track gain → pan → bus → master`, with **insert effects**. Recorded here as a phased evolution so the V1
decision is not mistaken for the end state, and so the data model can carry forward-looking shapes that the V1
scheduler simply ignores.

- **V2a — Per-track instrument (fixes the V1 tension): tag every note with a preset.** Widen the ring-buffer
  event to carry a **per-note preset index** (`NoteOn { note, preset }`), and store a **per-voice waveform** on
  `Voice` (captured at note-on, like the envelope already is). The render loop dispatches each voice by its
  *own* captured waveform instead of the single global `waveform`. The drum branch already does exactly this
  (it dispatches per-voice by `PRESETS[v.preset].waveform == Drums`), so the pattern is proven in-tree. This
  removes the global-preset bottleneck and lets a Piano clip and a Drums clip truly overlap. Alloc-free
  (one `Copy` field on a POD event + one field on `Voice`), no new lock. **Effort: small–moderate.**
- **V2b — Per-track gain + pan: a fixed per-track mixer on the RT thread.** Introduce a small fixed array of
  **track strips** (`[TrackStrip; MAX_TRACKS]`, e.g. 8) each holding `gain`/`pan` as atomics, and tag each note
  with a **track index** so each voice knows its strip. Render becomes per-track sub-mix (accumulate each
  voice into its track's stereo accumulator with `gain` and an equal-power pan law) then sum strips → master.
  This is the first time output is **stereo per-source**, so the `MASTER_GAIN`/limiter headroom proof must be
  re-derived for `MAX_TRACKS` strips (a new ADR will own that proof). Fixed arrays only — alloc-free.
  **Effort: moderate** (mostly the headroom re-proof and stereo bookkeeping).
- **V2c — Insert effects + buses: a bounded, alloc-free DSP graph.** A small fixed set of **insert slots** per
  strip and a fixed number of **buses/sends** (e.g. a reverb bus). Each effect is a state struct with a
  **pre-allocated, fixed-size** working buffer (delay line, filter memory) sized at stream build — never in the
  callback. This is where real DSP and real-time-safety risk concentrate; it is the largest phase and its own
  ADR(s). **Effort: large** — and explicitly *not* needed for V1 or V2a/b.

#### Where the scheduler ultimately lives (sub-decision)

V1: **UI scheduler (`setTimeout`-class), feeding the existing ring buffer ahead of the playhead.** Cheapest,
reuses replay, zero engine risk. Inherits the event-loop **jitter** ADR-0002 already accepts for replay; for a
short arrangement this is fine, for a long/dense song it drifts.

V2/V3 (deferred, own ADR): if timing fidelity becomes the bar, move scheduling to a **Rust-side scheduler on a
sample clock** — a timeline of pre-sorted `(sample_time, event)` consumed by the audio thread (or a high-priority
control thread that feeds the ring buffer a fixed lookahead ahead of the play cursor). This is the same
"move scheduling to a sample-clock" supersession ADR-0002 explicitly deferred. It is **not** V1 and **not**
required by V2a/b/c.

### Data model (UI-owned, like recordings; TypeScript shapes)

The UI owns arrangement state exactly as it owns recordings (ADR-0002). **Illegal states unrepresentable**:
ClipInstances reference a Recording by id (never embed events), required positioning fields are non-optional,
forward-looking fields (automation, buses/sends) are present in the *type* but **ignored by the V1 scheduler**
so the persisted shape is forward-compatible without committing the engine.

```ts
// src/arrangement.ts  (companion to src/recordings.ts; localStorage "musicware.arrangements.v1")

/** A take placed on a track at a position in time. References a Recording by id. */
export type ClipInstance = {
  id: string;            // instance id (a Recording may appear many times)
  recordingId: string;   // -> Recording.id in recordings.ts (the SOURCE OF TRUTH for events)
  startMs: number;       // timeline position of the clip's t=0, >= 0
  transpose: number;     // semitones, applied at flatten time (0 = none)
  loopCount: number;     // >= 1; how many times the clip repeats back-to-back
  // forward-looking (V1 scheduler ignores these):
  gainDb?: number;       // per-clip trim, default 0  (needs V2b mixer)
  trimStartMs?: number;  // crop in from the recording's start (default 0)
  trimEndMs?: number;    // crop out (default = recording.durationMs)
};

/** A lane of clips that maps to ONE instrument. */
export type Track = {
  id: string;
  name: string;          // "Drums", "Piano", "Bass"
  presetIndex: number;   // the track's instrument; V1: advisory + scheduler hint, V2a: honoured per-voice
  clips: ClipInstance[];
  muted: boolean;
  // forward-looking (need the V2b+ mixer; V1 scheduler ignores):
  gainDb?: number;       // per-track volume     (V2b)
  pan?: number;          // -1..1, L..R          (V2b)
  soloed?: boolean;
  inserts?: InsertSpec[];      // per-track effect chain (V2c)
  automation?: AutomationLane[]; // (V2 automation)
};

export type Arrangement = {
  id: string;
  name: string;
  createdAt: number;     // epoch ms
  tempoBpm: number;      // for a future bar/beat grid; V1 positions are absolute ms
  tracks: Track[];
  // forward-looking:
  buses?: Bus[];         // (V2c) shared FX buses
};

// ---- forward-looking only; defined so the persisted JSON is forward-compatible ----
export type AutomationPoint = { tMs: number; value: number };  // e.g. gain/pan over time
export type AutomationLane  = { param: "gain" | "pan"; points: AutomationPoint[] };
export type InsertSpec = { kind: string; params: Record<string, number>; bypass: boolean };
export type Bus  = { id: string; name: string; gainDb: number; inserts?: InsertSpec[] };
export type Send = { fromTrackId: string; toBusId: string; amountDb: number };
```

**What crosses to Rust:**
- **V1:** *nothing new.* The scheduler flattens to existing `note_on` / `note_off` / `set_preset` Tauri
  commands via `emit()`. Arrangement state never leaves the UI (same boundary as recordings).
- **V2a:** the ring-buffer `NoteEvent` widens to carry a per-note `preset` (and later `track`) — POD `Copy`,
  no allocation.
- **V2b/c:** per-track `gain`/`pan` as atomics (control-rate, like `set_volume` today), and a bounded effects
  graph configured at stream build. Effect *parameters* cross at control rate; **audio samples still never
  cross to the UI** (ADR-0001 preserved at every phase).

## Consequences

- **Positive:**
  - **The Rust real-time engine and all its proofs are completely untouched for V1** — zero new real-time
    risk, consistent with ADR-0002's discipline. Arrangement ships as a thin, unit-testable TypeScript leaf.
  - **Reuses everything:** Recordings as clips, `emit()` as the dispatch path, the note broadcast for
    highlight/chord/visualizer (ADR-0004), and replay's scheduling shape. A clip "sounds like what was played"
    by construction (same engine path).
  - **Forward-compatible data model:** automation, per-track gain/pan, buses/sends exist in the persisted
    type now and are honoured as the engine grows, so V1 JSON migrates cleanly. ClipInstance referencing a
    Recording id keeps one source of truth for events.
  - **The hard part (mixer/DSP graph) is explicitly phased and deferred** — V1 delivers the arrange-and-play
    learning value without paying for a mixer, and the engine grows only when a phase is actually wanted
    (evolutionary architecture / YAGNI).
- **Negative (cost accepted):**
  - **No simultaneous multi-timbre in V1** (the per-track-instrument tension): overlapping clips of different
    instruments collapse to one live waveform ("last preset wins"). Must be surfaced in the UI; fixed by V2a.
  - **No per-track volume/pan/effects in V1.** A track is mute/unmute + positioned clips only; gain/pan/FX
    need the V2b/c mixer. Per-track `gainDb`/`pan` fields exist but are inert in V1.
  - **`setTimeout`-class scheduling jitter** inherited from replay (ADR-0002): fine for short songs, drifts on
    long/dense ones. Sample-clock scheduling is the deferred fidelity supersession.
  - **`localStorage` only** — bound to one machine/origin, no export (same as ADR-0002). A durable store /
    project-file format is a later ADR.
- **Risks (with mitigation / fitness functions):**
  - **Users expect per-track instruments immediately.** *Mitigation:* surface the V1 limitation explicitly and
    lead with the single-timbre-at-a-time happy path; V2a is the clear, small next step. *Fitness function:*
    a UI/scheduler test that overlapping clips of one timbre play correctly, and that the limitation is
    flagged (not silently mis-rendered) when timbres differ.
  - **Scheduler drift becomes audible** on long arrangements. *Mitigation:* feed the ring buffer on a
    bounded *lookahead* rather than firing each event exactly at wall-clock; deferred sample-clock ADR if it
    matters. *Fitness function:* a flatten() unit test asserting event ordering, transpose clamping, and loop
    unrolling are correct independent of dispatch timing.
  - **V2b's stereo per-track sum breaks the headroom proof** (the current proof assumes a single mono sum
    scaled by `1/VOICE_COUNT`). *Mitigation:* V2b is its own ADR that re-derives boundedness for `MAX_TRACKS`
    strips; the V1 decision does not touch it.
  - **Effects (V2c) reintroduce real-time-safety risk** (delay lines, filters). *Mitigation:* fixed,
    pre-allocated working buffers sized at stream build; `assert_no_alloc` stays the guard; its own ADR(s).

## Alternatives considered

1. **Pre-render each clip to an audio buffer and mix audio (the "real DAW" path).** Render each Recording to
   PCM, then sum the buffers on the timeline. *Rejected for V1:* it needs a mixer the engine doesn't have, it
   stores opaque heavy audio (vs. tiny symbolic clips), and it **breaks the symbolic model** and ADR-0001's
   "audio samples never cross to the UI" / ADR-0002's symbolic-recording decision. It is also strictly more
   work than reusing replay. A bounce/export-to-WAV feature could pre-render *as an output*, but that is a
   separate later ADR, not the arrangement playback path.
2. **One engine instance per track** (N ring buffers + N voice pools, each with its own global preset → real
   per-track instruments and per-instance volume cheaply). *Rejected:* `cpal` opens one output stream per
   engine; multiple streams on one device fight over the callback/clock, multiply underrun risk, and waste the
   16-voice pool N times. It "solves" per-track timbre by duplicating the whole engine N times instead of the
   small, in-tree `Voice`-carries-its-waveform change (V2a) — more risk, less reuse. The voice pool is global
   by design (ADR-0001).
3. **Build the full mixer / DSP graph now** (per-track gain/pan/bus/master + insert effects in V1).
   *Rejected:* enormous scope (a stereo per-track sub-mix, a new headroom proof, an alloc-free effects
   framework with pre-sized buffers) for a beginner arrange-and-play feature. It violates YAGNI and the
   evolutionary-architecture/Strangler-Fig posture, and risks the engine's proven real-time safety for value
   V1 doesn't need. Captured instead as the explicit V2b/c phases.
4. **Rust-side scheduler from the start.** *Rejected for V1:* a sample-clock timeline on the audio thread is
   the right *fidelity* answer but is unnecessary work and risk for short beginner songs; the UI scheduler
   reuses replay and ships now. Left as the deferred fidelity supersession (own ADR), exactly as ADR-0002
   deferred sample-clock replay.
5. **Do nothing / keep single-take replay.** *Rejected:* arranging saved compositions into a song is the
   obvious next learning step and is achievable as a pure frontend leaf (V1) with no engine risk.

## Links
PRD: Song Arrangement (pending) · Issues: — · Related ADRs: builds on
[ADR-0001](ADR-0001-react-tauri-rust-audio-engine.md) (dispatch boundary, audio never crosses to the UI),
generalises [ADR-0002](ADR-0002-composition-recording-frontend-event-stream.md) (symbolic capture/replay; clip
= Recording), constrained by [ADR-0003](ADR-0003-master-volume-post-render-limiter.md) (single master /
headroom proof — V2b must re-derive it) and the global-preset/per-voice model of
[ADR-0005](ADR-0005-drums-note-mapped-one-shot-percussion.md) (the per-voice-dispatch pattern V2a reuses) and
[ADR-0006](ADR-0006-vibrato-lfo-pitch-modulation.md); reuses [ADR-0004](ADR-0004-visualizer-note-broadcast-representation.md)
(note broadcast drives highlight/visualizer during arrangement playback) · Tech-spec: TS (pending) ·
Glossary terms touched: PROPOSES adding "Arrangement", "Track" (DAW timeline sense — note tension with the
existing audio-track glossary entry), "Clip instance", "Scheduler / Arrangement transport", "Transpose",
"Mix/DSP graph", "Bus / Send", "Automation lane" (owner of `docs/CONTEXT.md` to decide).
```
