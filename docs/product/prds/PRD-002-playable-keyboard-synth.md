# PRD-002 — Playable keyboard synthesizer

> Owner: developer (solo). Date: 2026-06-23. Status: **Draft**.
> Scope: a playable software instrument built **on top of** the STORY-01 real-time engine.
> tracker.mode = local — work items tracked as a checklist below and in `state.openDebt`.
> **Reads on top of PRD-001.** This PRD *deliberately* relaxes one of PRD-001's non-goals
> (software synthesis). See "Relationship to PRD-001" before treating any non-goal as settled.

---

## Problem & opportunity

PRD-001 set the recording-DAW MVP. STORY-01 then proved the hard, scary part: a Rust/`cpal`
real-time thread can emit glitch-free audio at a 512-sample buffer, with the no-allocation /
no-lock invariant enforced by the build (`assert_no_alloc`). That slice produces a single fixed
440 Hz sine.

The developer's stated learning goal (BC-001) is **hands-on audio-DSP depth**. The richest,
most motivating DSP to learn next is not the recording chain — it is **synthesis**: turning that
one fixed sine into a *playable instrument*. Doing so exercises the core ideas every synth and
sampler shares — note events, polyphony, amplitude envelopes, and waveform/timbre shaping —
and it does so by **building directly on the already-proven real-time engine** rather than
standing up a new subsystem (mic capture, permissions, disk I/O) first.

Why now: the marginal feasibility risk is low (the real-time output path is proven), the payoff
is immediate and tangible (press a key, hear a note), and for a personal learning project, a
playable instrument is intrinsically motivating in a way a half-built record button is not.

---

## Outcomes & success metrics

**One measurable outcome — a playable, polyphonic, click-free instrument that stays glitch-free under load:**

| Criterion | Pass definition |
|---|---|
| Playable | An on-screen keyboard (and computer-key mapping) triggers notes at the correct pitch |
| Polyphonic | At least 8 notes can sound simultaneously (a held chord), summed without clipping |
| Click-free | No audible click/pop on note-on or note-off (amplitude envelope ramps from/to silence) |
| Expressive timbre | Selectable waveform (sine / saw / square / triangle) + a simple additive preset, giving an audibly distinct "organ-ish" vs "piano-ish" character |
| **Glitch-free under load** | **0 underruns at a 512-sample buffer for 60 s with the maximum voice count sounding** — the STORY-01 fitness function, now under polyphonic load |
| Explainable | Developer can trace a key-press from UI event → note event → voice → envelope → mixed output buffer, without external docs |

The headline criterion is the last-but-one: **0 underruns under full polyphony**. Everything else
is audible/observable; that one is the engineering gate that says "the DSP fits the real-time budget."

---

## The 4 risks (and how each is addressed)

**Value — LOW.**
Same basis as PRD-001: the value is personal learning plus a usable artifact. A playable synth
delivers the BC-001 learning outcome (audio DSP) *directly* — envelopes, polyphony, and additive
synthesis are core DSP, not peripheral. It is also immediately gratifying, which protects the real
viability risk below. No market, acquisition, or revenue dependency.

**Usability — LOW–MEDIUM.**
A keyboard is a universally understood metaphor; an on-screen piano plus the conventional
QWERTY-row mapping (used by most soft synths) needs no manual. The real usability risks are
mechanical, not conceptual:
- **Key-repeat / focus in the WebView**: a held physical key must fire exactly one note-on and one
  note-off — OS key-repeat must not retrigger the note. (Tested in `vitest`.)
- **Felt latency**: the delay from key-press to sound must feel instant. This rides the same
  low-latency in-process Tauri command path STORY-01 used; if it feels laggy, escalate (open question).

**Feasibility — LOW (the hard part is already proven).**
STORY-01 retired the dominant feasibility risk (glitch-free real-time output). The residual,
*narrower* feasibility questions this PRD opens:
1. Does **polyphonic voice mixing + per-sample envelope** computation stay within the real-time
   budget at 512 frames with 0 underruns? → STORY-K3's fitness function (the headline gate).
2. Does **note-event delivery** (UI → real-time thread) feel instant and never block the callback?
   → handled by a lock-free ring buffer of note events drained at the top of each callback block
   (the ADR-0001 mechanism), so the real-time thread never waits and never allocates.
The `assert_no_alloc` invariant from STORY-01 still guards the (now more complex) callback — voice
mixing, envelope stepping, and event draining must all stay allocation-free, enforced by the build.

**Business viability — MOTIVATION / SCOPE (this is the axis that needs the honest answer).**
There is no commercial viability risk. For a personal learning project, **viability = sustained
motivation + deliberate scope**. The honest tension: **PRD-002 opens a second track before PRD-001's
recording MVP is finished** (only STORY-01 of 7 is done). The failure mode is two half-built
features and no finished one. This is mitigated, not ignored:
- PRD-002 is **small and additive**: one new engine module (a voice/synth layer) feeding the
  *existing* `cpal` output stream, plus one UI panel. It does not touch the recording roadmap.
- It is a **conscious fork, recorded as such** — not silent drift. PRD-001's acceptance test still
  stands unchanged as the "recording DAW" goal (see below).
- For *this* developer right now, the synth is the higher-motivation path and reuses proven
  foundations — so it is the better bet against the motivation risk than forcing the record button.

**Honesty about this bet:** that last point is a *conviction*, not a discovered fact — there is no
artifact validating "the synth sustains motivation better than recording" the way POC-002 partially
validates PRD-001's usability. The confidence is **not yet earned.** Falsification signal: if
STORY-K1→K2 stall for more than ~2 weeks of intended effort, the fork failed its own premise —
park PRD-002 and return to PRD-001's recording leg rather than leaving two half-built tracks.

---

## Relationship to PRD-001 (scope reconciliation — read this)

PRD-001 lists, under **Out of scope**, two items this PRD touches:
- "**MIDI** — no MIDI input, output, or clock" — **still upheld.** PRD-002 adds *no hardware MIDI*.
  It uses the standard note-number→frequency math (`f = 440·2^((n−69)/12)`) purely as pitch
  arithmetic; that is not MIDI I/O.
- "**Effects beyond gain/pan**" — **still upheld.** No reverb/EQ/compression here.

The one PRD-001 non-goal PRD-002 **deliberately relaxes** is the *implicit* one that the MVP
contained no sound *synthesis* beyond a feasibility test tone. PRD-002 makes synthesis a
first-class, intentional learning goal.

**PRD-001 is NOT superseded.** Its 7-story recording MVP and its acceptance test remain the
canonical "musicware as a recording DAW" goal. PRD-002 is a **parallel, additive learning track**
that shares the real-time audio engine. To keep the two documents from silently contradicting each
other, PRD-001's non-goal list is annotated with a one-line pointer to this PRD (done as part of
this change — mirrors how the glossary was reconciled after ADR-0001).

---

## Users / personas

**The developer.** Solo engineer learning audio DSP and React + Rust desktop architecture; also the
sole user. Wants depth (now specifically: synthesis DSP) and a playable artifact. (BC-001.)

---

## Solution narrative

The developer launches musicware and sees, alongside the (eventual) track lanes, a **keyboard
panel**: one or two octaves of on-screen keys, a waveform/timbre selector, and an octave shift.
Clicking a key — or pressing the mapped computer key (`A S D F …` for white keys, `W E T Y U` for
black) — sounds a note at the right pitch *instantly*. The note doesn't click on: it swells in over
a few milliseconds and releases smoothly when the key lifts. Holding several keys plays a chord —
the voices sum cleanly without crackle. Flipping the timbre selector from the bright saw to the
stacked-harmonic additive preset turns a thin buzz into a fuller, organ-like sustain. The developer
plays for a minute straight, watching a counter confirm **0 underruns**, then traces exactly how a
key-press became sound: UI event → note event on the ring buffer → a voice claimed from the pool →
its oscillator and envelope stepped per sample → summed into the output buffer the OS pulls. That
trace is the learning payoff.

---

## User stories (vertical slices — ordered by dependency)

Each slice is independently demoable. **STORY-K1** is the plumbing gate (note events end-to-end);
**STORY-K3** carries the headline fitness function (polyphony without underruns).

### Work-item checklist

- [ ] **STORY-K1 — One playable note, end-to-end** *(plumbing gate)*
  As a developer, I want pressing a key to start a note at that key's pitch and releasing it to stop
  the note, so that the UI → real-time-thread note-event path works end-to-end without glitches.

  **Acceptance criteria:**
  - A minimal on-screen key surface (≥ one octave) issues a `note_on{note_number}` on press and a
    `note_off{note_number}` on release, via Tauri commands.
  - Note events reach the real-time thread through a **lock-free ring buffer** drained at the top of
    each callback block — the callback never allocates and never locks (still under `assert_no_alloc`).
  - A single sounding voice plays the correct pitch (verified against `f = 440·2^((n−69)/12)`).
  - Releasing the key stops the note. (Mono / last-note-priority is acceptable in this slice.)
  - No underruns during a short interactive play session at a 512-sample buffer.

- [ ] **STORY-K2 — ADSR envelope (no clicks)**
  As a developer, I want each note to fade in and out via an attack/decay/sustain/release envelope,
  so that notes don't click or pop on start/stop.

  **Acceptance criteria:**
  - Each voice has an ADSR amplitude envelope; note-on starts attack, note-off starts release.
  - The rendered buffer shows no discontinuity at note boundaries, with a concrete tolerance: the
    envelope's first and last output samples are below −60 dBFS (|x| < 0.001), and the per-sample
    envelope step never exceeds a fixed bound (no instantaneous jump). This **unit test is the
    authoritative gate**; the by-ear check below is a sanity check, not the criterion.
  - Envelope parameters are fixed constants for this slice (no UI control yet).
  - Sanity check (by ear): no click/pop on rapid note on/off.

- [ ] **STORY-K3 — Polyphony (fixed voice pool)** *(headline fitness function)*
  As a developer, I want to hold several keys and hear them all at once, so that I can play chords.

  **Acceptance criteria:**
  - A fixed-size voice pool (target: ≥ 8 voices) allocates a voice per note-on and frees it after the
    release tail; the pool is a fixed array — **no heap allocation in the callback**.
  - When more notes than voices are requested, the oldest voice is stolen (documented, deterministic).
  - Held chords sum without clipping (amplitude scaled / soft-limited so N voices stay within range —
    headroom unit test).
  - **Headline gate:** `cargo test --test glitch_free_60s` (extended to hold the maximum voice count
    sounding) reports **0 underruns** at a 512-sample buffer over 60 s on Apple Silicon.
  - The gate must be **non-vacuous**: if no output device is available or the maximum voice count
    cannot be exercised, the test **fails**, it does not silently skip. (STORY-01's harness currently
    `return`s on no device — this slice must change that so "0 underruns" cannot pass by doing nothing.)
  - A short, **non-`#[ignore]`d** smoke variant (e.g. `GLITCH_TEST_SECS=2` under full polyphony) runs
    in the normal `cargo test` pass so the loop exercises the path on every run; the 60 s run remains
    the `#[ignore]`d, developer-invoked acceptance gate.

- [ ] **STORY-K4 — Selectable waveform / timbre**
  As a developer, I want to choose the oscillator waveform (and a simple additive preset), so that I
  can shape the instrument's character between organ-ish and piano-ish.

  **Acceptance criteria:**
  - Waveform selectable among sine / saw / square / triangle, plus one **additive** waveform (a fixed
    sum of a few harmonics). ("Waveform" = oscillator shape; a *preset* below = a named waveform +
    envelope combination — the two are distinct.)
  - Switching waveform changes the timbre audibly and takes effect within a buffer or two.
  - At least two recognisable presets exist, each a waveform + envelope combination: a sustained,
    harmonically-rich "organ-ish" tone (additive waveform + sustained envelope) and a brighter,
    faster-decaying "piano-ish" tone (shaped by ADSR + waveform together).
  - Waveform generators are pure functions of phase (unit-tested: e.g. saw is monotonic within a
    period, square is two-valued, all are bounded in [−1, 1]).

- [ ] **STORY-K5 — Full keyboard surface (computer-key mapping + on-screen polish)**
  As a developer, I want a proper playable keyboard — mapped computer keys, multi-octave on-screen
  keys, and octave shift — so that the instrument is comfortable to play.

  **Acceptance criteria:**
  - QWERTY mapping: white keys on the `A S D F G H J K` row, black keys on `W E T Y U`; octave
    shift keys (e.g. `Z` / `X`).
  - A held physical key fires **exactly one** note-on and one note-off — OS key-repeat does not
    retrigger (unit-tested in `vitest`).
  - On-screen keys highlight while held (from either mouse or computer key), and pressing multiple
    keys plays them polyphonically (ties to STORY-K3).
  - Octave range covers at least C2–C6 via shifting.

---

## Scope — Now / Next / Later (+ Out of scope)

**Now (this PRD):** playable on-screen + computer keyboard; polyphonic voices; ADSR; selectable
waveform incl. one additive preset; glitch-free under full polyphony.

**Next (only after this PRD's outcome is met):** a couple of named instrument presets; a simple
low-pass filter (the gateway to subtractive synthesis); per-voice pitch glide. Each belongs in a
future PRD.

**Later:** integration with the recording roadmap (record the synth's output as a track in PRD-001's
graph) — explicitly deferred until both this PRD and PRD-001's recording leg exist.

**Out of scope (explicit non-goals for PRD-002):**
- **Hardware MIDI** — no MIDI input devices, output, or clock (note-number math ≠ MIDI I/O).
- **Velocity / aftertouch / expression** — notes are fixed-velocity in this PRD.
- **Effects** — no reverb/EQ/compression/delay (PRD-001's non-goal upheld).
- **Sampling** — no sample playback; this is a synthesis-only instrument.
- **Filters / LFOs / modulation matrix** — beyond the additive preset, no subtractive filter or
  modulation in this PRD (named as the likely *Next* step).
- **Saving/recalling patches** — no preset persistence.
- **Recording the synth** — capturing synth output into a track is PRD-001/Later territory.

---

## Implementation decisions

**Builds on the STORY-01 engine.** The existing `cpal` output stream and its dedicated real-time
thread are reused. A new **synth/voice layer** becomes the sound source the callback renders, in
place of the single fixed sine (`fill_sine`). The `glitch_free_60s` harness and the `assert_no_alloc`
guard carry forward unchanged in role.

**Note-event transport.** UI → Rust note-on/note-off travel as **Tauri commands**; the Rust core
pushes them onto a **lock-free ring buffer** (the ADR-0001 mechanism, glossary: *ring buffer*). The
audio callback drains all pending events at the top of each block, then renders — so the real-time
thread never blocks on the UI and never allocates.

**Voice model.** A **fixed-size array of voices** (target ≥ 8), each owning: phase accumulator,
note number, waveform selection, and an ADSR envelope state machine. Allocation = mark a free (or
oldest, when stealing) voice active; **no `Vec`, no heap, no lock in the callback.** Per block: drain
events → update voice states → for each active voice step oscillator + envelope per sample → sum →
scale for headroom → write to the output buffer.

**Pitch.** Note number → frequency via `f = 440·2^((n−69)/12)` (standard equal-temperament; A4 = 69
= 440 Hz). This is pitch arithmetic, **not** MIDI I/O.

**Waveforms.** sine / saw / square / triangle as pure functions of phase; the **additive** preset is
a fixed sum of a few sine partials (organ-ish). All bounded to [−1, 1] before envelope scaling.

**Headroom.** Polyphonic sum is amplitude-scaled (and/or soft-limited) so the maximum voice count
stays within range without clipping; the scaling rule is unit-tested.

**Open architectural question (may warrant a tiny tech-spec).** The exact note-event mechanism
(ring buffer of `NoteEvent` vs. an atomic bitset of held notes for a first cut) is the one decision
with a real trade-off; resolve it in STORY-K1 and, if non-trivial, record it as TS-002.

**UI.** A React keyboard panel: on-screen keys (mouse), computer-key mapping (keydown/keyup with
key-repeat suppression), waveform selector, octave shift. Reuses the STORY-01 Tauri-command pattern.

---

## Testing decisions

**Headline fitness function (gate).** `cargo test --test glitch_free_60s`, extended to hold the
maximum voice count sounding for 60 s → **0 underruns** at a 512-sample buffer on Apple Silicon.
This is STORY-01's gate re-run under polyphonic load (STORY-K3). **It must fail, not skip**, if it
cannot exercise that load (no device / fewer voices than expected) — otherwise it is not an eval.
A short non-`#[ignore]`d polyphony smoke (`GLITCH_TEST_SECS=2`) runs every `cargo test` so the path
is exercised in the loop, not only on a remembered manual invocation.

**Rust engine — `cargo test`.**
- Envelope: attack ramps 0→peak, release ramps →0; no discontinuity at note boundaries (STORY-K2).
- Waveforms: shape + bounds per waveform; additive preset is bounded (STORY-K4).
- Voice allocation: Nth simultaneous note steals the oldest voice deterministically (STORY-K3).
- Headroom: max-voice sum stays within [−1, 1] after scaling (STORY-K3).
- **No-alloc:** extend the existing `callback_hot_path_does_not_allocate` test to cover event drain
  + multi-voice mix + envelope stepping under `assert_no_alloc` (carries the STORY-01 invariant).

**React UI — `vitest`.**
- Keyboard component emits exactly one `note_on` on key/mouse down and one `note_off` on up — **no
  double-fire under OS key-repeat** (STORY-K5).
- Octave shift maps keys to the correct note numbers.
- Tauri command dispatch: mock the IPC boundary; verify the correct command/payload on interaction.

**Manual checks (acceptance gate).**
- Click-free note on/off by ear (STORY-K2). Chords sound clean (STORY-K3).
- Organ-ish vs piano-ish presets are audibly distinct (STORY-K4).
- Felt latency from key-press to sound is instant (ties to DEBT-002 latency confirmation).

**Non-goals for testing.** No browser automation; no benchmarking beyond the fitness function.

---

## Discovery evidence & open questions

**Opportunity Solution Tree branch.** Root outcome: developer gains hands-on audio-DSP depth
(BC-001). Opportunity: a *playable instrument* is the most motivating, foundation-leveraging way to
learn synthesis DSP (note events, polyphony, envelopes, additive timbre) — and it reuses the
already-proven STORY-01 real-time engine instead of opening a new subsystem.

**Evidence in hand.**
- STORY-01 (committed `e975552`): glitch-free real-time output proven in this codebase; the
  no-alloc/no-lock invariant is build-enforced. The synth layer slots directly onto it.
- ADR-0001: stack + IPC + ring-buffer mechanism this PRD relies on.

**Unvalidated assumptions (PRD-002 scope).**

| # | Assumption | What would prove/disprove it |
|---|---|---|
| KA1 | Polyphonic mix + per-sample envelope fits the real-time budget @512/60 s with 0 underruns | STORY-K3 fitness function (the gate) |
| KA2 | A lock-free ring buffer of note events delivers note-on/off without blocking or allocating in the callback | STORY-K1 + extended no-alloc test |
| KA3 | Key-press→sound latency over the Tauri command path feels instant | manual check + DEBT-002 latency confirmation |
| KA4 | OS key-repeat can be suppressed so a held key fires one note-on/off | STORY-K5 `vitest` test |

**Optional de-risking spike (recommended before K1).** KA1 (polyphony fits the real-time budget) is
the dominant residual risk yet is only *answered* at STORY-K3, the third slice. A cheap throwaway
spike — N silent voices with envelopes summed inside the existing callback under `assert_no_alloc`,
timed against the 512-frame budget — would de-risk the headline assumption before K1/K2 sink effort,
mirroring how STORY-01 itself de-risked PRD-001. Tracked as DEBT-012.

**Open questions.**
- ~~Note-event mechanism: ring buffer of `NoteEvent` vs. atomic held-notes bitset?~~ **Resolved in STORY-K1**: a pre-allocated lock-free SPSC ring buffer (`ringbuf`) of `Copy` `NoteEvent`, drained at the top of each callback block. No TS-002 needed.
- Voice count (8 / 16) and the exact headroom-scaling rule.
- ~~Keep the STORY-01 raw test tone (`start_tone`/`stop_tone`)?~~ **Resolved in STORY-K1**: the fixed-440 path was removed; the lifecycle commands were renamed `start_engine`/`stop_engine` and now start the engine **silent** (sound comes only from `note_on`).

**New vocabulary introduced (added to `docs/CONTEXT.md` as part of this change).**
*voice, polyphony, envelope (ADSR), oscillator / waveform, note event (note-on / note-off),
note number / pitch, voice stealing.*

---

## Links

- Business case: `docs/product/business-cases/BC-001-musicware-learning-daw.md`
- Architecture decision: `docs/architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md`
- Container diagram: `docs/architecture/diagrams/c4-container.md`
- Related PRDs: **PRD-001** (musicware MVP — recording DAW; this PRD is a parallel, additive track)
- Tech-specs: TS-002 (pending — only if the note-event mechanism warrants it)
- Tracker issues: local checklist above (tracker.mode = local)
