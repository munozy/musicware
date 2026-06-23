# Spike 2 — polyphony fits the real-time budget? (PRD-002 KA1 / DEBT-012)

**Date:** 2026-06-23 · **Machine:** Apple Silicon (developer's Mac) · **Status:** THROWAWAY spike, question answered.

## Question
PRD-002 assumption **KA1**: does *polyphonic mix + per-sample ADSR envelope* fit the 512-frame
real-time budget? This is the dominant residual feasibility risk for the synth track, and it was
otherwise only going to be answered at STORY-K3 (the 3rd slice). Answer it first.

## Method
A standalone, throwaway Rust crate (`prototypes/spike-2-polyphony-budget/`) models the **worst-case**
render cost — no cpal, no device, just the DSP:
- **16 voices** (generous polyphony target), each an **8-partial additive oscillator** (the most
  expensive realistic waveform — the "organ-ish" preset; cheaper waveforms cost strictly less).
- **Per-sample linear ADSR** on every voice, re-triggering so the load stays continuous and every
  envelope branch executes.
- Interleaved stereo 512-frame blocks, summed and scaled for headroom.
- The render path is wrapped in `assert_no_alloc` with the `AllocDisabler` global allocator in debug
  — the same mechanism the production engine uses.
- ~5,168 blocks rendered (≈ 60 s of audio); each block timed individually; worst-case block reported.

Budget per block = 512 / 44,100 Hz = **11.610 ms**.

## Results

| Build | Mean / block | Worst-case / block | % of budget (worst) |
|---|---|---|---|
| Debug (`cargo run`) | 0.256 ms | 0.439 ms | 3.8 % |
| Release (`cargo run --release`) | 0.255 ms | **0.475 ms** | **4.1 %** |

- **No-alloc:** the debug build completed without an `assert_no_alloc` panic → the render path
  (oscillator + envelope + mix) is **allocation-free**, as required.
- **Timing:** worst-case block ≈ **0.48 ms vs an 11.6 ms deadline → ~24× headroom.**

## Verdict — KA1: PASS (comfortable)
Polyphonic synthesis fits the real-time budget with enormous margin. The DSP compute is ~4% of the
per-block deadline at the worst-case waveform and full voice count, leaving the other ~96% for cpal
callback overhead, OS scheduling jitter, and future per-voice features (filter, more partials). The
headline STORY-K3 gate (0 underruns @512/60s under full polyphony) is **feasible**; building the
STORY-K1 plumbing on top of it is justified.

## Honest caveats (what this spike does NOT prove)
- It measures **compute cost only**, not the full real-time path. Real underruns also depend on cpal
  callback scheduling and system load — but STORY-01 already hit 0 underruns with a single sine, and
  this shows 16 additive voices add only ~0.4 ms, so the scheduling margin is essentially unchanged.
- Naive `sin()`-per-partial is the **upper bound**; a wavetable oscillator would be cheaper still.
- The definitive proof remains the **STORY-K3 gate on the real cpal stream**. This spike retires the
  "does the math fit?" risk so that effort on K1/K2 is not spent on an unproven assumption.

## Disposition
- **KA1 → de-risked** (proven in mechanism; STORY-K3 remains the formal gate, as STORY-01's 60s gate
  remains the formal proof for A1).
- **DEBT-012 → resolved.**
- Throwaway crate kept for the record; not part of the app build (standalone, no workspace link).
