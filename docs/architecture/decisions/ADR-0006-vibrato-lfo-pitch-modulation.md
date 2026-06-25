# ADR-0006 — Vibrato via a per-voice LFO phase modulation (the Theremin)

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-25
- **Deciders:** Architecture + developer (munozy)

## Context
The Theremin timbre needs **vibrato** — a continuous pitch wobble — which the existing model didn't have.
Every prior tonal preset is a *static* oscillator: a pure function of a phase that advances by a fixed
`phase_delta` per sample. Vibrato means the instantaneous frequency must vary over time, driven by a
low-frequency oscillator (LFO). This is the engine's first **modulation source**, so how it's wired matters
for the usual constraints: alloc-free / lock-free callback, no `sr` in the render hot path, bounded output.

## Decision
We will add a minimal **per-voice LFO** (`Voice.lfo_phase`, `Voice.lfo_inc`) and apply vibrato as a
**per-sample phase modulation** in `render_block`: the waveform stays a pure `eval_waveform(phase)` (a warm
near-sine, bounded by its norm), and the LFO nudges the phase advance by
`THEREMIN_VIB_DEPTH · phase_delta · sin(lfo_phase)` so the net advance is `phase_delta·(1 + depth·sin)` —
i.e. ±`depth` frequency vibrato. `lfo_inc` (radians/sample) is **precomputed at note-on** (where the sample
rate is known), so the render loop needs no `sr` and does no allocation. It is **inert for other presets**:
`lfo_phase` is reset to 0 at **every** note-on and `lfo_inc` is 0 for non-theremin voices, so the LFO stays
frozen at phase 0 and the nudge `depth·phase_delta·sin(lfo_phase) = depth·phase_delta·sin(0) = 0`. (The
invariant is `sin(lfo_phase)=0`, which the per-note `lfo_phase` reset guarantees — `lfo_inc=0` alone would
*not* suffice if a stale phase were left on a reused voice slot.)

## Consequences
- **Positive:** vibrato with almost no new surface — two `f32` fields and a few lines in the render loop;
  the headroom proof is untouched (the waveform is still bounded by construction; the LFO only changes
  *when* the phase is sampled, not its range). It's a reusable primitive: any future preset can arm the LFO
  for vibrato, and the same field could later drive tremolo (amplitude) or filter modulation.
- **Negative / accepted:** depth and rate are global constants (no per-note expressiveness, no UI control
  yet); the modulation is applied in the shared phase-advance path gated on the live waveform (consistent
  with the global-waveform model). Portamento (gliding *between* notes — the other classic theremin trait)
  is **not** included; it would need a per-voice glide state and is deferred.
- **Risks:** none to RT-safety/headroom. If many modulation targets are added later, an ad-hoc set of
  per-voice fields would get unwieldy and want a small modulation abstraction — out of scope now (YAGNI).

## Alternatives considered
- **FM / phase-modulation synthesis** for the wobble: rejected — FM changes the *timbre* (sidebands), not a
  clean pitch vibrato; wrong character.
- **A global (shared) LFO** for all voices: simpler, but locks every voice's vibrato in phase; per-voice
  `lfo_phase` is barely more code and lets each note's vibrato start fresh.
- **A general modulation matrix** (sources × destinations): over-engineered for one vibrato (YAGNI).
- **Skip vibrato, ship a plain swelling sine:** rejected — vibrato is the theremin's defining cue.

## Links
PRD: PRD-002 · Related ADRs: ADR-0001 (engine/RT-safety) · Glossary terms touched: Theremin, Vibrato, LFO ·
Code: `src-tauri/src/audio.rs` (`Waveform::Theremin`, `THEREMIN_*` consts, `Voice.lfo_phase/lfo_inc`, the
vibrato block in `render_block`).
