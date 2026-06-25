# ADR-0005 — Drums: note-mapped, one-shot percussion synthesis

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-25
- **Deciders:** Architecture + developer (munozy)

## Context
Every timbre so far (Sine, Saw, Square, Triangle, Organ, EPiano, Bell) follows one model: the played note
maps to a pitch, an oscillator is a pure function of phase (`eval_waveform(kind, phase)`), and the note
sustains under an ADSR until note-off. Drums break all three assumptions:

- A drum is **unpitched** — the key chooses *which* drum (kick, snare, hat…), not a frequency.
- Drum sources are **stateful and noisy** (white noise, a high-pass filter, a pitch sweep) — they cannot be
  a stateless `f(phase)`.
- A drum is a **one-shot**: it rings out its own decay; holding or quickly releasing the key shouldn't
  change or choke it.

The engine's hard constraints still apply: the callback is alloc-free / lock-free, and every sample must be
in `[-1, 1]` so the `MASTER_GAIN` + limiter headroom proof holds.

## Decision
We will add a single **`Drums` preset** (and a `Waveform::Drums` marker) that maps the note's **pitch class**
(`note % 12`) to a drum and synthesises it in a dedicated **`render_block` drum branch**, not via
`eval_waveform` (whose `Drums` arm returns 0.0 and which stays out of `ALL_WAVEFORMS`).

- **Sources:** kick/toms are pitch-swept sines (kick 180→50 Hz); snare is a body tone + bright noise; hats,
  crash, clap, rim are **bright noise** (the first difference of xorshift white noise, clamped — a cheap
  high-pass that reads as crisp/metallic rather than muddy). Cowbell is a squared sine; ride is tone + noise.
- **Per-voice state** (on `Voice`, inert for other presets): an xorshift `noise_state` (seeded non-zero per
  hit), a baked amplitude env `drum_amp` (× a per-sample `drum_amp_mult`), a tone increment `drum_freq` in
  **radians/sample** swept toward `drum_freq_end` by `drum_freq_mult`, and a `drum_filt` high-pass memory.
  All sample-rate-dependent coefficients are **precomputed at note-on** (`apply_event` has the sample rate),
  so the render loop needs no `sr` — no `exp`, no allocation in the hot path.
- **One-shot lifecycle:** `apply_event` ignores `NoteOff` for drum voices; the drum branch frees the voice
  when `drum_amp ≤ ENV_FLOOR`. The preset's ADSR is just a 0.6 ms declick-attack that then holds
  (sustain 1) — the baked `drum_amp` owns the decay and the freeing.
- **Boundedness:** every drum source is in `[-1, 1]` (mixes sum to ≤ 1; bright noise is clamped) and
  `drum_amp ≤ 1`, so the headroom proof is preserved unchanged.

## Consequences
- **Positive:** a whole percussion category is added without touching the real-time-safety or headroom
  invariants, without a new IPC surface, and reusing the preset/voice machinery. The kit records and replays
  like any other preset (the recorder is timbre-agnostic). The pitch-class mapping means a kit fits one
  octave and repeats across the keyboard.
- **Negative / accepted:** drum **sound quality** is fully synthesised (no samples) and tuned by ear — it
  will never match a sampled kit; the recipes (decay times, sweep, noise/tone balance) are taste-driven
  constants. The chord/visualizer UI still interprets drum keys as pitches (a known cosmetic mismatch).
  Some short drums hold a (silent) voice until their amp floor; voice-stealing covers any exhaustion.
- **Risks:** a future sampled-kit or per-drum-filter upgrade would revisit the synthesis (not this mapping).
  The xorshift seed must stay non-zero (guarded with `| 1`).

## Alternatives considered
- **A pitched percussive waveform** (one drum sound, played at the key's pitch): rejected — that's a tom at
  best, not a kit; users expect a kit from a "Drums" timbre.
- **Sampled drums (load WAVs):** rejected for now — needs asset bundling + a sample player + disk I/O, a much
  larger change; synthesis keeps the engine self-contained and alloc-free.
- **A separate drum engine / second voice pool:** rejected — over-engineered; the existing voice pool +
  a render branch + a few per-voice fields suffice (YAGNI).
- **Mapping octave to intensity/velocity:** deferred — there is no velocity yet; pitch-class→drum is enough.

## Links
PRD: PRD-002 (playable synth) · Related ADRs: ADR-0001 (engine/RT-safety), ADR-0003 (master limiter) ·
Glossary terms touched: Drum kit, One-shot · Code: `src-tauri/src/audio.rs` (`Waveform::Drums`,
`drum_params`/`drum_source`/`bright_noise`, the `render_block` drum branch).
