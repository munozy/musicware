//! Real-time audio engine for musicware.
//!
//! STORY-01 proved glitch-free output with a single fixed sine.  STORY-K1 turns
//! that into a **note-driven instrument**: the UI sends note-on / note-off
//! events, and a single voice sounds the requested pitch.
//!
//! Architecture
//! ============
//! `cpal::Stream` is `!Send`/`!Sync`, so it cannot live in Tauri managed state.
//! A dedicated **audio thread** owns the `Stream` for its entire lifetime.
//! Tauri-managed state (`AudioEngine`) holds only `Send + Sync` handles:
//!   - `running`        – `AtomicBool`  signals the thread to stop
//!   - `underruns`      – `AtomicUsize` incremented by the cpal error callback
//!   - `dropped_events` – `AtomicUsize` incremented when the event queue is full
//!   - `producer`       – `Mutex<Option<NoteProducer>>`, the control-thread end of
//!     the note-event queue (the audio thread never touches it)
//!   - `thread`         – `Mutex<Option<JoinHandle>>` joined on stop
//!
//! Note events (control → audio thread)
//! ====================================
//! Note-on/note-off travel over a pre-allocated, lock-free **SPSC ring buffer**
//! (`ringbuf`).  The Tauri command thread is the single producer; the audio
//! thread is the single consumer.  The buffer is allocated once at engine start
//! (never in the callback).  If it is ever full (a pathological burst), the
//! producer drops the event and bumps `dropped_events` — it never blocks, spins,
//! or allocates.  The audio callback drains all pending events with `try_pop`
//! (pure index math on pre-allocated memory) at the top of each block.
//!
//! Real-time safety
//! ================
//! The cpal data callback must never allocate and never acquire a lock.  Voices
//! live on the audio thread's stack; events arrive via the lock-free queue.
//! In debug/test builds the callback body is wrapped in `assert_no_alloc` — any
//! accidental heap allocation panics immediately rather than silently glitching.
//!
//! Voice model (STORY-K3: polyphony)
//! =================================
//! A fixed `VoicePool` of `[Voice; VOICE_COUNT]` voices (no heap).  A note-on is
//! allocated to a voice by `alloc_index`: reuse a voice already playing that note,
//! else the first idle voice, else **steal the oldest** (smallest `age`, a
//! monotonic per-pool counter — deterministic).  A note-off releases every
//! sounding voice playing that note.  The summed output is scaled by a fixed
//! `MASTER_GAIN = 1/VOICE_COUNT` so any combination of voices stays within
//! `[-AMPLITUDE, AMPLITUDE]` — clipping is impossible *by construction*.
//!
//! Envelope (STORY-K2)
//! ===================
//! Each voice has a linear **ADSR** amplitude envelope.  A note-on starts the
//! attack; a note-off starts the release; the voice goes silent (stage `Idle`)
//! only when the release reaches zero.  The envelope ramps the amplitude in and
//! out, so notes no longer click on note-on/note-off.  Each sample's output is
//! `amp * envelope * eval_waveform(phase)`; the per-sample envelope step is
//! bounded (no instantaneous jump), and a note from silence starts at envelope 0.
//!
//! Waveforms & presets (STORY-K4)
//! ==============================
//! `eval_waveform` provides selectable oscillator shapes (sine / saw / square /
//! triangle + two additive registrations: organ drawbars and an electric piano),
//! each bounded to [-1, 1] so the headroom proof holds for any waveform.  A `Preset` bundles a waveform with an `AdsrSpec`; the selected
//! preset (e.g. Sine / Organ / Piano) is an `AtomicU8` read once per block.  The
//! waveform applies live to all voices; each voice captures its envelope preset at
//! note-on (so an in-flight note keeps its envelope when the preset changes).
//!
//! Error callback note (CoreAudio)
//! ================================
//! On CoreAudio, cpal surfaces stream problems (including buffer underruns)
//! through the error callback.  "0 error-callback invocations" is the practical
//! proxy for "0 underruns."  The `underruns` counter measures exactly this.

use assert_no_alloc::assert_no_alloc;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, StreamConfig};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Per-voice peak amplitude.  Also the hard output ceiling: because the summed
/// voices are scaled by `MASTER_GAIN = 1/VOICE_COUNT`, the mix peaks at exactly
/// `AMPLITUDE` even with all voices at full envelope and in phase (see `render_block`).
/// 0.8 keeps single notes audible while leaving headroom below full scale (1.0).
const AMPLITUDE: f32 = 0.8;

/// Envelope floor for exponential decay/release: a geometric tail never reaches
/// exactly 0, so below this the voice snaps to silence/Idle and frees.  1e-4
/// (−80 dBFS) is a decade below the −60 dBFS declick threshold, so it's inaudible.
const ENV_FLOOR: f32 = 1.0e-4;
/// ln(1000) — an exponential decay's T60 (−60 dB) factor is `e^(-LN_1000/(T60·sr))`.
const LN_1000: f32 = 6.907_755;

/// Preferred buffer size in frames (512 ≈ 11 ms at 44.1 kHz).
const PREFERRED_BUFFER_FRAMES: u32 = 512;

/// Number of simultaneous voices (polyphony).  POC-003 validated 16 at ~4% of
/// the 512-frame budget.  Allocation/stealing/headroom are all written in terms
/// of this constant, so it is a one-line change.
pub const VOICE_COUNT: usize = 16;

/// Headroom scale applied to the summed voices inside `render_block`.  Each voice
/// contributes at most `AMPLITUDE`, so `sum(N voices) * MASTER_GAIN <= AMPLITUDE`
/// for any N and any phases — the render itself can never clip, and the scale is
/// constant so there is no zipper/pumping as voices enter and leave.
const MASTER_GAIN: f32 = 1.0 / VOICE_COUNT as f32;

/// Volume gain at `level == 1.0`.  `render_block` already attenuates a single full
/// voice to `AMPLITUDE * MASTER_GAIN`; multiplying by this brings it back to full
/// scale, so the user's `level` knob reads as "single-note peak amplitude" (0..1).
/// The post-render limiter (`apply_master_volume`) hard-clamps the result, so
/// driving the level up can never emit an out-of-range sample — clipping the DAC
/// is impossible by construction; the knob just trades headroom for loudness.
const VOLUME_GAIN_MAX: f32 = VOICE_COUNT as f32 / AMPLITUDE;

/// Default master level — the old fixed `MASTER_GAIN`-only path made a single note
/// peak at ~0.05 (−26 dB), which was too quiet.  0.6 is ~12× louder yet leaves the
/// limiter room before chords reach full scale.
const DEFAULT_VOLUME: f32 = 0.6;

/// Capacity of the note-event queue.  Drained every ~11 ms block, so steady-state
/// occupancy is ~0–2; 256 gives orders-of-magnitude headroom against a burst.
const EVENT_QUEUE_CAPACITY: usize = 256;

const TWO_PI: f32 = 2.0 * std::f32::consts::PI;

// ---------------------------------------------------------------------------
// Waveforms (STORY-K4)
// ---------------------------------------------------------------------------

/// Oscillator shape.  `Copy` so it crosses the callback boundary by value.
/// `Organ`, `EPiano` and `Bell` are additive registrations (see the harmonic tables).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Saw,
    Square,
    Triangle,
    Organ,
    EPiano,
    Bell,
    /// A theremin: a warm near-sine voiced with continuous pitch VIBRATO and a soft
    /// swell envelope. The waveform itself is a pure phase function (`eval_waveform`);
    /// the vibrato is applied as a per-sample phase modulation in `render_block`.
    Theremin,
    /// A percussion kit: the note's pitch class selects a drum (kick, snare, hat,
    /// tom…). Unpitched/noise-based and stateful, so it is synthesised in
    /// `render_block`'s drum branch, NOT via `eval_waveform`.
    Drums,
}

/// Organ registration — Hammond drawbar-style: fundamental, octaves (k2,k4,k8)
/// and a fifth (k3,k6), with the buzzy odd partials (k5,k7) dropped, for a warm,
/// round tone rather than the saw-like 1/k series.
const ORGAN_HARMONICS: [f32; 8] = [1.0, 0.7, 0.5, 0.4, 0.0, 0.25, 0.0, 0.2];
/// Piano registration — a full, smoothly-decreasing harmonic series (fundamental
/// through the 8th, rolling off) → a rich, warm struck-string tone (paired with the
/// exponential ring-down envelope).
const EPIANO_HARMONICS: [f32; 8] = [1.0, 0.55, 0.4, 0.28, 0.18, 0.12, 0.08, 0.05];
/// Normalisers ≥ Σ|harmonics|, so each additive waveform is in [-1, 1] *by
/// construction* (|Σ aₖ·sin| ≤ Σ aₖ ≤ NORM) — preserving the headroom proof.
const ORGAN_NORM: f32 = 3.06; // Σ = 3.05
const EPIANO_NORM: f32 = 2.67; // Σ = 2.66

/// Theremin — a near-pure sine with just a hint of 2nd/3rd harmonic for a warm,
/// vocal body (the eerie theremin tone). The character comes from the VIBRATO +
/// soft-swell envelope, not the spectrum.
const THEREMIN_HARMONICS: [f32; 8] = [1.0, 0.12, 0.06, 0.0, 0.0, 0.0, 0.0, 0.0];
const THEREMIN_NORM: f32 = 1.19; // ≥ Σ|amps| (1.18) → ∈[-1,1] by construction (true peak ~0.84)
/// Vibrato: a gentle pitch wobble — the theremin's signature. ~5.5 Hz, ±3% of the
/// frequency (≈ ±0.5 semitone). Applied as a per-sample phase modulation.
const THEREMIN_VIB_HZ: f32 = 5.5;
const THEREMIN_VIB_DEPTH: f32 = 0.03;

/// Bell — INHARMONIC church-bell partials (frequency ratios relative to the played
/// note): hum (½ below), prime, the minor-third TIERCE (1.2 — the signature bell
/// overtone the ear recognises), fifth, nominal (octave), and two higher partials.
/// The non-integer ratios are what make it read as a bell rather than an organ.
/// Each voice runs an independent phase per partial, so a non-integer ratio causes
/// no 2π-wrap discontinuity (see `render_block`'s Bell branch).
const BELL_PARTIALS: usize = 7;
const BELL_RATIOS: [f32; BELL_PARTIALS] = [0.5, 1.0, 1.2, 1.5, 2.0, 2.4, 3.0];
const BELL_AMPS: [f32; BELL_PARTIALS] = [0.5, 1.0, 0.6, 0.4, 0.45, 0.2, 0.15];
const BELL_NORM: f32 = 3.31; // ≥ Σ|amps| (3.30) → bell ∈ [-1,1] by construction

/// Per-partial decay time (T60, seconds).  THE defining bell cue is *differential*
/// decay: the bright high partials (the metallic "clang" of the strike) die in
/// ~1 s while the hum (½) and prime ring on for many seconds — that bright→pure
/// transition is what the ear hears as a bell rather than a static inharmonic
/// chord.  Index 0 (the hum) is the longest-lived and MUST be the max — the main
/// envelope (preset 3) uses this same T60 so the per-partial gains below are purely
/// *relative* to it (see `Voice::bell_decay`).
const BELL_T60: [f32; BELL_PARTIALS] = [8.0, 6.0, 5.0, 3.5, 3.0, 1.5, 1.0];
const BELL_T60_MAX: f32 = BELL_T60[0]; // the hum — slowest decay, == the main env's T60

/// Sum of 8 integer harmonics at `phase`, normalised into [-1, 1] (`norm` ≥ Σ|amps|).
/// Stack-only fixed loop — no allocation.  (Organ/EPiano; the Bell is inharmonic.)
fn additive_sum(phase: f32, amps: &[f32; 8], norm: f32) -> f32 {
    let mut sum = 0.0f32;
    for k in 1..=amps.len() {
        sum += amps[k - 1] * (k as f32 * phase).sin();
    }
    sum / norm
}

/// The inharmonic bell spectrum sampled at a single `phase` (for `eval_waveform` /
/// bounds tests).  The live voice render uses per-partial phases in `render_block`.
fn bell_at(phase: f32) -> f32 {
    let mut sum = 0.0f32;
    for p in 0..BELL_PARTIALS {
        sum += BELL_AMPS[p] * (BELL_RATIOS[p] * phase).sin();
    }
    sum / BELL_NORM
}

/// Evaluate a waveform at `phase ∈ [0, 2π)`.  Pure function of phase; every
/// branch returns strictly within [-1, 1] (the precondition the `MASTER_GAIN`
/// headroom proof depends on).
///
/// DEBT: Saw and Square are *naive* (not band-limited) — they alias audibly on
/// high notes (harmonics fold past Nyquist). Acceptable/instructive for a learning
/// keyboard; band-limiting (PolyBLEP / wavetable) is a future story.
fn eval_waveform(kind: Waveform, phase: f32) -> f32 {
    let t = phase * (1.0 / TWO_PI); // normalized phase ∈ [0, 1)
    match kind {
        Waveform::Sine => phase.sin(),
        Waveform::Saw => 2.0 * t - 1.0, // ramp -1 → +1, monotonic within a period
        Waveform::Square => {
            if t < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        Waveform::Triangle => 1.0 - 4.0 * (t - 0.5).abs(), // -1 at t=0, +1 at t=0.5
        Waveform::Organ => additive_sum(phase, &ORGAN_HARMONICS, ORGAN_NORM),
        Waveform::EPiano => additive_sum(phase, &EPIANO_HARMONICS, EPIANO_NORM),
        Waveform::Bell => bell_at(phase),
        Waveform::Theremin => additive_sum(phase, &THEREMIN_HARMONICS, THEREMIN_NORM),
        // Drums are noise/stateful and rendered in `render_block`'s drum branch;
        // they never reach this pure single-phase path. 0.0 keeps it total.
        Waveform::Drums => 0.0,
    }
}

// ---------------------------------------------------------------------------
// Drums (percussion kit) — the note's pitch class picks a drum. Unpitched noise
// + pitch-swept sines, each with its own decay. Bounded to [-1, 1] by
// construction (every mix sums to ≤ 1) and alloc-free (xorshift noise + sines),
// so the headroom proof and RT-safety hold.
// ---------------------------------------------------------------------------

/// Per-drum parameters for pitch class `note % 12`:
/// (amp-decay τ secs, tone start Hz, tone end Hz, pitch-sweep τ secs).
/// A 0 start-Hz means a pure-noise drum (no tone). end==start means no sweep.
fn drum_params(cls: usize) -> (f32, f32, f32, f32) {
    match cls {
        0 => (0.09, 180.0, 50.0, 0.018), // C  kick — fast, deep pitch drop = thump
        1 => (0.006, 0.0, 0.0, 0.0),     // C# rim/stick — very short bright click
        2 => (0.11, 190.0, 150.0, 0.06), // D  snare — body tone (drops) + bright wires
        3 => (0.05, 0.0, 0.0, 0.0),      // D# clap — short bright noise
        4 => (0.20, 120.0, 88.0, 0.07),  // E  tom low — sine with a pitch drop
        5 => (0.17, 165.0, 120.0, 0.07), // F  tom mid
        6 => (0.04, 0.0, 0.0, 0.0),      // F# closed hat — short bright noise
        7 => (0.14, 220.0, 165.0, 0.06), // G  tom high
        8 => (0.22, 0.0, 0.0, 0.0),      // G# open hat — medium bright noise
        9 => (0.55, 0.0, 0.0, 0.0),      // A  crash — long bright noise wash
        10 => (0.18, 540.0, 540.0, 0.0), // A# cowbell — square tone
        _ => (0.30, 520.0, 520.0, 0.0),  // B  ride — bright wash + a tonal ping
    }
}

/// One white-noise sample in [-1, 1) via an in-place xorshift32 (alloc-free,
/// deterministic per seed). `state` must be non-zero.
fn drum_noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as f32 / u32::MAX as f32) * 2.0 - 1.0
}

/// Bright (high-passed) noise: the first difference of white noise emphasises the
/// top end, turning a muddy "shhh" into a crisp metallic "tss" — the character of
/// hats/cymbals/snare-wires. `prev` carries the previous sample; clamped to [-1,1].
fn bright_noise(rng: &mut u32, prev: &mut f32) -> f32 {
    let x = drum_noise(rng);
    let hp = (x - *prev).clamp(-1.0, 1.0);
    *prev = x;
    hp
}

/// Advance `phase` by `inc` radians/sample and return the sine — the tonal
/// component of pitched drums (`inc` is precomputed at note-on, so no `sr` here).
fn drum_tone(phase: &mut f32, inc: f32) -> f32 {
    *phase += inc;
    while *phase >= TWO_PI {
        *phase -= TWO_PI;
    }
    phase.sin()
}

/// The raw drum source for pitch class `cls` in [-1, 1] (pre-amplitude-envelope).
/// `freq_inc` is the current tone increment (radians/sample); `phase`/`rng`/`filt`
/// are the voice's tone phase, noise state and high-pass memory.
fn drum_source(cls: usize, phase: &mut f32, freq_inc: f32, rng: &mut u32, filt: &mut f32) -> f32 {
    match cls {
        0 | 4 | 5 | 7 => drum_tone(phase, freq_inc), // kick / toms — pitch-swept sine
        2 => 0.45 * drum_tone(phase, freq_inc) + 0.55 * bright_noise(rng, filt), // snare: body + wires
        10 => {
            // cowbell — squared sine for a hollow metallic tone
            if drum_tone(phase, freq_inc) >= 0.0 {
                0.7
            } else {
                -0.7
            }
        }
        11 => 0.4 * drum_tone(phase, freq_inc) + 0.55 * bright_noise(rng, filt), // ride: ping + wash
        _ => bright_noise(rng, filt), // rim / clap / hats / crash — bright noise
    }
}

// ---------------------------------------------------------------------------
// Presets (STORY-K4): a waveform + an envelope, selectable live
// ---------------------------------------------------------------------------

/// Envelope decay/release shape.  `Linear` ramps at a constant per-sample rate
/// (organ-style).  `Exponential` multiplies by a per-sample coefficient — a
/// fast-drop-then-long-tail ring-down, the defining amplitude cue of a struck
/// string (piano).  For `Exponential` presets, `decay_secs`/`release_secs` are
/// reinterpreted as the **T60** (time to fall 60 dB), not "time to reach target".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnvShape {
    Linear,
    Exponential,
}

/// Sample-rate-independent ADSR spec (times in seconds).  Built into the
/// per-sample `Adsr` via `Adsr::from_spec`.
#[derive(Clone, Copy)]
struct AdsrSpec {
    attack_secs: f32,
    decay_secs: f32,
    sustain: f32,
    release_secs: f32,
    shape: EnvShape,
}

/// A timbre: an oscillator waveform plus its envelope shape. (Display names live
/// in the UI; presets are referenced by index here.)
#[derive(Clone, Copy)]
struct Preset {
    waveform: Waveform,
    adsr: AdsrSpec,
}

pub const PRESET_COUNT: usize = 6;

/// The selectable presets.  Index 0 (Sine) reproduces the pre-K4 sound exactly.
static PRESETS: [Preset; PRESET_COUNT] = [
    // 0: "Sine" — the pre-K4 default sound (behavior-preserving).
    Preset {
        waveform: Waveform::Sine,
        adsr: AdsrSpec {
            attack_secs: 0.008,
            decay_secs: 0.060,
            sustain: 0.7,
            release_secs: 0.120,
            shape: EnvShape::Linear,
        },
    },
    // 1: "Organ" — drawbar additive + fast attack + high sustain → a warm held drone.
    Preset {
        waveform: Waveform::Organ,
        adsr: AdsrSpec {
            attack_secs: 0.006,
            decay_secs: 0.050,
            sustain: 0.9,
            release_secs: 0.110,
            shape: EnvShape::Linear,
        },
    },
    // 2: "Piano" — warm additive + EXPONENTIAL ring-down (the struck-string amplitude
    // cue): fast initial drop, long tail. decay/release are T60 times.
    Preset {
        waveform: Waveform::EPiano,
        adsr: AdsrSpec {
            attack_secs: 0.003,
            decay_secs: 2.500, // T60: fast drop, long natural ring
            sustain: 0.0,
            release_secs: 0.180, // T60: damper falls promptly on key-up
            shape: EnvShape::Exponential,
        },
    },
    // 3: "Bells" — inharmonic registration with DIFFERENTIAL per-partial decay.
    // The main env decays at the hum's rate (BELL_T60_MAX = 8 s); the per-partial
    // gains (see Voice::bell_decay) fade the bright partials faster, giving the
    // bell's struck "clang → long pure hum" ring-down.
    Preset {
        waveform: Waveform::Bell,
        adsr: AdsrSpec {
            attack_secs: 0.002,
            decay_secs: 8.000, // T60 == BELL_T60_MAX (the hum): bells ring for seconds
            sustain: 0.0,
            release_secs: 0.400, // a softer damper than the piano
            shape: EnvShape::Exponential,
        },
    },
    // 4: "Drums" — a percussion kit. The note picks the drum; the amplitude shape
    // and decay are baked per-drum (Voice::drum_amp), so this envelope is just a
    // 2 ms declick attack that then holds (sustain 1) — it never caps the drum's
    // own decay or frees the voice (the drum branch does that at its amp floor).
    Preset {
        waveform: Waveform::Drums,
        adsr: AdsrSpec {
            attack_secs: 0.0006, // a near-instant onset — the percussive transient/snap
            decay_secs: 0.050,
            sustain: 1.0,
            release_secs: 0.010,
            shape: EnvShape::Linear,
        },
    },
    // 5: "Theremin" — a warm near-sine with a SOFT SWELL (slow attack/release, high
    // sustain) so there's no percussive onset, just a continuous wavering tone. The
    // eerie pitch vibrato is applied per-sample in render_block (no envelope role).
    Preset {
        waveform: Waveform::Theremin,
        adsr: AdsrSpec {
            attack_secs: 0.070, // slow swell in — vocal/bowed, never a click
            decay_secs: 0.120,
            sustain: 0.85,
            release_secs: 0.250, // gentle fade out on key-up
            shape: EnvShape::Linear,
        },
    },
];

/// Build the per-preset `Adsr` table for a given sample rate.  Allocation-free
/// (fixed array); called once on the audio thread before the stream is built.
fn build_adsr_table(sample_rate: f32) -> [Adsr; PRESET_COUNT] {
    std::array::from_fn(|i| Adsr::from_spec(PRESETS[i].adsr, sample_rate))
}

/// Producer (control-thread) end of the note-event ring buffer.
pub type NoteProducer = HeapProd<NoteEvent>;
/// Consumer (audio-thread) end of the note-event ring buffer.
pub type NoteConsumer = HeapCons<NoteEvent>;

// ---------------------------------------------------------------------------
// Note events
// ---------------------------------------------------------------------------

/// A note-on or note-off carrying its note number.  `Copy` POD — it crosses the
/// ring buffer by value, has no `Drop`, and allocates nothing in the callback.
/// `note_off` carries the note number so a release can be matched to the voice
/// playing that note (and so K3 polyphony can free the right voice).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteEvent {
    NoteOn { note: u8 },
    NoteOff { note: u8 },
}

/// Equal-temperament note number → frequency in Hz.  A4 (note 69) = 440 Hz.
pub fn note_to_freq(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/// Stage of a voice's ADSR amplitude envelope.  `Idle` = not sounding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnvStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

/// One sounding (or silent) note.  Lives only on the audio thread.
#[derive(Clone, Copy)]
struct Voice {
    phase: f32,
    phase_delta: f32,
    note: u8,
    stage: EnvStage,
    env: f32,   // current envelope amplitude, 0..1
    age: u64,   // allocation sequence number — larger = more recently triggered
    preset: u8, // preset captured at note-on — selects this voice's envelope
    // Independent phase per Bell partial (inert for other waveforms). One phase per
    // inharmonic partial keeps each sin continuous across its own 2π wrap.
    bell_phases: [f32; BELL_PARTIALS],
    // Per-partial gain RELATIVE to the main envelope, and its per-sample decay
    // multiplier (computed from `BELL_T60` at strike).  The main env decays at the
    // hum's rate (`BELL_T60_MAX`); these multiply on top so each partial's *net*
    // decay is its own `BELL_T60[p]` — the bright partials fade first.  Inert
    // (gain 1, decay 1) for non-bell voices.
    bell_gain: [f32; BELL_PARTIALS],
    bell_decay: [f32; BELL_PARTIALS],
    // Drums state (inert for other waveforms). The note's pitch class picks the
    // drum at note-on; `drum_amp` is the baked amplitude envelope (1→0) that
    // multiplies the source and frees the voice at its floor; `drum_freq` is the
    // tone increment in radians/sample, swept toward `drum_freq_end` (the kick's
    // pitch drop) by `drum_freq_mult`. All precomputed at note-on (no `sr` in the
    // render path). `noise_state` is the xorshift PRNG (must stay non-zero).
    noise_state: u32,
    drum_amp: f32,
    drum_amp_mult: f32,
    drum_freq: f32,
    drum_freq_end: f32,
    drum_freq_mult: f32,
    drum_filt: f32, // previous noise sample — for the bright (high-pass) noise of hats/snare
    // Vibrato LFO (Theremin; inert elsewhere — lfo_inc 0 ⇒ no modulation). Seeded at
    // a theremin note-on; `render_block` modulates the phase by it each sample.
    lfo_phase: f32,
    lfo_inc: f32,
}

impl Voice {
    const SILENT: Voice = Voice {
        phase: 0.0,
        phase_delta: 0.0,
        note: 0,
        stage: EnvStage::Idle,
        env: 0.0,
        age: 0,
        preset: 0,
        bell_phases: [0.0; BELL_PARTIALS],
        bell_gain: [1.0; BELL_PARTIALS],
        bell_decay: [1.0; BELL_PARTIALS],
        noise_state: 1,
        drum_amp: 0.0,
        drum_amp_mult: 1.0,
        drum_freq: 0.0,
        drum_freq_end: 0.0,
        drum_freq_mult: 1.0,
        drum_filt: 0.0,
        lfo_phase: 0.0,
        lfo_inc: 0.0,
    };

    /// Is this voice contributing sound (anything but fully released)?
    fn is_sounding(&self) -> bool {
        self.stage != EnvStage::Idle
    }
}

/// The fixed polyphony pool, owned on the audio thread.  `next_age` is a
/// monotonic counter stamped onto each voice on note-on so "oldest" (smallest
/// age) is a deterministic, alloc-free `min` scan.
struct VoicePool {
    voices: [Voice; VOICE_COUNT],
    next_age: u64,
}

impl VoicePool {
    fn new() -> Self {
        Self {
            voices: [Voice::SILENT; VOICE_COUNT],
            next_age: 0,
        }
    }

    /// Count of currently-sounding voices (used by the non-vacuous gate).
    fn sounding_count(&self) -> usize {
        self.voices.iter().filter(|v| v.is_sounding()).count()
    }
}

/// Choose the voice index a note-on should claim, in priority order:
///   1. a voice already sounding this exact `note` (same-note reuse → one voice
///      per held key, preserving retrigger continuity);
///   2. the first idle voice;
///   3. otherwise **steal the oldest** sounding voice (smallest `age`; ties broken
///      by lowest index).
///
/// Pure index math — no allocation, no lock.  Deterministic: the chosen index is
/// a pure function of the pool state, so stealing is unit-testable exactly.
///
/// Deferred debt: a stolen voice is re-tasked immediately with no fast-release
/// fade. The envelope stays continuous (env is not reset), so only the pitch
/// jumps — at worst a soft glitch, never a hard click; with 16 voices stealing is
/// unreachable in normal play. A 1–2 ms steal ramp is a later enhancement.
fn alloc_index(voices: &[Voice], note: u8) -> usize {
    // 1. same-note reuse
    if let Some(i) = voices
        .iter()
        .position(|v| v.is_sounding() && v.note == note)
    {
        return i;
    }
    // 2. first idle
    if let Some(i) = voices.iter().position(|v| !v.is_sounding()) {
        return i;
    }
    // 3. steal the oldest (smallest age)
    let mut oldest = 0;
    for i in 1..voices.len() {
        if voices[i].age < voices[oldest].age {
            oldest = i;
        }
    }
    oldest
}

/// Per-sample ADSR rates, derived once from the device sample rate.
#[derive(Clone, Copy)]
struct Adsr {
    attack_inc: f32,   // env rise per sample during attack
    decay_inc: f32,    // env fall per sample during linear decay
    release_inc: f32,  // env fall per sample during linear release
    decay_mult: f32,   // per-sample factor during exponential decay (∈ (0,1))
    release_mult: f32, // per-sample factor during exponential release (∈ (0,1))
    sustain: f32,
    shape: EnvShape,
}

impl Adsr {
    /// Build per-sample rates from a sample-rate-independent spec.  Both the linear
    /// increments and the exponential multipliers are computed; `step_env` uses
    /// whichever matches `shape`.  For exponential, `decay_secs`/`release_secs` are
    /// T60 times: the per-sample factor is `10^(-3 / (T60·sr)) = e^(-ln1000/(T60·sr))`.
    /// `exp()` runs here (once, off the audio thread), never in the callback.
    fn from_spec(spec: AdsrSpec, sample_rate: f32) -> Self {
        let decay_samples = (spec.decay_secs * sample_rate).max(1.0);
        let release_samples = (spec.release_secs * sample_rate).max(1.0);
        Self {
            attack_inc: 1.0 / (spec.attack_secs * sample_rate).max(1.0),
            // Linear: ramp from full scale to 0/sustain (reaches silence from any
            // level, incl. sustain 0 — a `sustain/release` rate would stall there).
            decay_inc: (1.0 - spec.sustain) / decay_samples,
            release_inc: 1.0 / release_samples,
            // Exponential: geometric ring-down over the T60 (factor in (0,1)).
            decay_mult: (-LN_1000 / decay_samples).exp(),
            release_mult: (-LN_1000 / release_samples).exp(),
            sustain: spec.sustain,
            shape: spec.shape,
        }
    }
}

/// Return this sample's envelope value, then advance the voice's envelope one
/// sample.  Returning the *current* value before advancing means a note from
/// silence emits envelope 0 on its first sample — no onset click.  Transitions
/// clamp (never overshoot), so the per-sample step never exceeds `attack_inc`.
fn step_env(voice: &mut Voice, adsr: &Adsr) -> f32 {
    let current = voice.env;
    match voice.stage {
        EnvStage::Idle => return 0.0,
        EnvStage::Attack => {
            voice.env += adsr.attack_inc;
            if voice.env >= 1.0 {
                voice.env = 1.0;
                voice.stage = EnvStage::Decay;
            }
        }
        EnvStage::Decay => match adsr.shape {
            EnvShape::Linear => {
                voice.env -= adsr.decay_inc;
                if voice.env <= adsr.sustain {
                    voice.env = adsr.sustain;
                    voice.stage = EnvStage::Sustain;
                }
            }
            EnvShape::Exponential => {
                voice.env *= adsr.decay_mult; // geometric ring-down
                if voice.env <= ENV_FLOOR.max(adsr.sustain) {
                    if adsr.sustain > ENV_FLOOR {
                        voice.env = adsr.sustain;
                        voice.stage = EnvStage::Sustain;
                    } else {
                        // The geometric tail never reaches exactly 0 — snap to
                        // silence below the floor so the voice frees (reaches Idle).
                        voice.env = 0.0;
                        voice.stage = EnvStage::Idle;
                    }
                }
            }
        },
        EnvStage::Sustain => {
            voice.env = adsr.sustain;
        }
        EnvStage::Release => match adsr.shape {
            EnvShape::Linear => {
                voice.env -= adsr.release_inc;
                if voice.env <= 0.0 {
                    voice.env = 0.0;
                    voice.stage = EnvStage::Idle;
                }
            }
            EnvShape::Exponential => {
                voice.env *= adsr.release_mult;
                if voice.env <= ENV_FLOOR {
                    voice.env = 0.0;
                    voice.stage = EnvStage::Idle;
                }
            }
        },
    }
    current
}

/// Apply one note event to the pool.  Note-on allocates a voice (`alloc_index`)
/// and (re)triggers its attack; note-off releases every sounding voice playing
/// that note.
fn apply_event(pool: &mut VoicePool, ev: NoteEvent, sample_rate: f32, current_preset: u8) {
    match ev {
        NoteEvent::NoteOn { note } => {
            let i = alloc_index(&pool.voices, note);
            pool.next_age += 1;
            let age = pool.next_age;
            let v = &mut pool.voices[i];
            v.note = note;
            v.phase_delta = TWO_PI * note_to_freq(note) / sample_rate;
            v.stage = EnvStage::Attack;
            v.age = age;
            // Capture the live preset so this voice keeps its envelope even if the
            // preset is switched while it sounds (set on every alloc path: reuse,
            // first-idle, and steal).
            v.preset = current_preset;
            // For a Bell strike, restore the bright partials (gain → 1) and recompute
            // each partial's per-sample RELATIVE decay from its T60: a partial faster
            // than the hum (BELL_T60_MAX) decays by the *difference* in rate, so its
            // net decay (hum env × relative) is exactly its own BELL_T60[p].  The hum
            // itself gets relative decay 1.0.  bell_gain ≤ 1 always → boundedness held.
            if PRESETS[current_preset as usize].waveform == Waveform::Bell {
                for (p, &t60) in BELL_T60.iter().enumerate() {
                    v.bell_gain[p] = 1.0;
                    let extra_rate = 1.0 / t60 - 1.0 / BELL_T60_MAX; // ≥ 0
                    v.bell_decay[p] = (-LN_1000 * extra_rate / sample_rate.max(1.0)).exp();
                }
            }
            // For a Drums hit, pick the drum from the pitch class and precompute its
            // per-sample amplitude decay + tone increment/sweep (radians/sample, so
            // the render path needs no sample rate). Reset phase + seed the noise.
            if PRESETS[current_preset as usize].waveform == Waveform::Drums {
                let sr = sample_rate.max(1.0);
                let (tau, f_start, f_end, sweep_tau) = drum_params((note % 12) as usize);
                let two_pi_over_sr = TWO_PI / sr;
                v.phase = 0.0;
                v.phase_delta = 0.0; // drums advance their tone phase via drum_freq
                v.drum_amp = 1.0;
                v.drum_amp_mult = (-1.0 / (tau * sr)).exp();
                v.drum_freq = f_start * two_pi_over_sr;
                v.drum_freq_end = f_end * two_pi_over_sr;
                v.drum_freq_mult = if sweep_tau > 0.0 {
                    (-1.0 / (sweep_tau * sr)).exp()
                } else {
                    1.0
                };
                v.drum_filt = 0.0;
                // Seed the PRNG distinctly per hit (must be non-zero).
                v.noise_state = (note as u32).wrapping_mul(2_654_435_761)
                    ^ (age as u32).wrapping_mul(40_503)
                    | 1;
            }
            // Always reset the vibrato LFO phase at note-on so sin(lfo_phase)=0 at the
            // start of EVERY note — the vibrato nudge is depth·phase_delta·sin(lfo_phase),
            // so a stale phase left on a reused voice slot would be a constant DC pitch
            // detune. Arm lfo_inc only for a Theremin note (radians/sample, precomputed
            // so the render path needs no sample rate); 0 elsewhere freezes the LFO.
            v.lfo_phase = 0.0;
            v.lfo_inc = if PRESETS[current_preset as usize].waveform == Waveform::Theremin {
                TWO_PI * THEREMIN_VIB_HZ / sample_rate.max(1.0)
            } else {
                0.0
            };
            // bell_phases are NOT reset: leaving them continuous avoids a click on a
            // bell re-strike; from silence the attack ramps from env 0 anyway.
            // Neither phase nor env is reset: both stay continuous so retriggering
            // (or stealing) a sounding voice has no amplitude jump — the attack
            // ramps from the current env up to 1.  From silence the env is already
            // 0, so the attack starts at 0 — no onset click.
        }
        NoteEvent::NoteOff { note } => {
            // Release every voice still playing this note (normally exactly one).
            // Skipping voices already in Release means a duplicate/late off doesn't
            // re-release a tail.  No match → no-op (e.g. key-up after a steal).
            for v in pool.voices.iter_mut() {
                // Drums are one-shots: ignore note-off so a quick tap rings out its
                // full baked decay instead of choking; the drum branch frees the
                // voice at its amplitude floor.
                if PRESETS[v.preset as usize].waveform == Waveform::Drums {
                    continue;
                }
                if v.is_sounding() && v.stage != EnvStage::Release && v.note == note {
                    v.stage = EnvStage::Release;
                }
            }
        }
    }
}

/// Fill `out` with interleaved samples by summing every sounding voice, each
/// shaped by the live `waveform` and its own (per-voice) ADSR envelope, then
/// scaling the sum by `MASTER_GAIN` for headroom.
///
/// Stack-only: no allocations, no locks — safe to call from a real-time callback.
/// `eval_waveform` is bounded to [-1, 1] and `env ∈ [0, 1]`, so each voice
/// contributes at most `amp`; with `MASTER_GAIN = 1/VOICE_COUNT` the written
/// sample stays within `[-amp, amp]` for any number of voices — the mix can never
/// clip, for *any* waveform.
fn render_block(
    out: &mut [f32],
    voices: &mut [Voice],
    channels: usize,
    amp: f32,
    waveform: Waveform,
    adsr_table: &[Adsr; PRESET_COUNT],
) {
    // cpal always delivers whole interleaved frames, so `out.len()` is a multiple
    // of `channels`; the integer division below therefore drops nothing.
    let frame_count = out.len() / channels.max(1);
    for frame in 0..frame_count {
        let mut sample = 0.0f32;
        for v in voices.iter_mut() {
            if v.is_sounding() {
                let env = step_env(v, &adsr_table[v.preset as usize]);
                // Drums are dispatched per-VOICE (by the preset it was struck with),
                // not by the live block waveform — a one-shot drum must keep decaying
                // and self-free even if the user switches to another preset mid-tail
                // (otherwise its branch is skipped and, with sustain 1 + note-off
                // ignored, the voice strands and leaks a DC term). Bell + tonal
                // waveforms stay GLOBAL (held notes re-timbre live, STORY-K4).
                let voice_is_drum = PRESETS[v.preset as usize].waveform == Waveform::Drums;
                let s = if voice_is_drum {
                    // Drum source (∈[-1,1]) shaped by the baked amplitude env; the env
                    // decays and, at its floor, frees the voice (drums ignore note-off).
                    let cls = (v.note % 12) as usize;
                    let src = drum_source(
                        cls,
                        &mut v.phase,
                        v.drum_freq,
                        &mut v.noise_state,
                        &mut v.drum_filt,
                    );
                    let out = src * v.drum_amp;
                    v.drum_amp *= v.drum_amp_mult;
                    v.drum_freq =
                        v.drum_freq_end + (v.drum_freq - v.drum_freq_end) * v.drum_freq_mult;
                    if v.drum_amp <= ENV_FLOOR {
                        v.env = 0.0;
                        v.stage = EnvStage::Idle;
                    }
                    out
                } else if waveform == Waveform::Bell {
                    // Bell sums INHARMONIC partials, each on its own phase accumulator
                    // so a non-integer ratio causes no 2π-wrap discontinuity; bounded
                    // to [-1,1] by /BELL_NORM.
                    let mut acc = 0.0f32;
                    for p in 0..BELL_PARTIALS {
                        // Each partial's amplitude is its registration weight scaled by
                        // its relative gain, so high partials thin out as the strike
                        // settles into the hum (the bell's bright→pure decay).
                        acc += BELL_AMPS[p] * v.bell_gain[p] * v.bell_phases[p].sin();
                        v.bell_phases[p] += v.phase_delta * BELL_RATIOS[p];
                        while v.bell_phases[p] >= TWO_PI {
                            v.bell_phases[p] -= TWO_PI;
                        }
                        v.bell_gain[p] *= v.bell_decay[p]; // ≤ 1 → never grows
                    }
                    acc / BELL_NORM
                } else {
                    eval_waveform(waveform, v.phase)
                };
                sample += amp * env * s;
                // Theremin vibrato: nudge the phase by a slow LFO so the instantaneous
                // frequency wobbles ±VIB_DEPTH around the note (the loop adds the base
                // phase_delta below → net advance = phase_delta·(1 + depth·sin(lfo))).
                // For non-theremin voices lfo_inc=0 freezes the LFO and lfo_phase was
                // reset to 0 at note-on, so sin(lfo_phase)=0 → the nudge is exactly zero.
                if waveform == Waveform::Theremin {
                    v.lfo_phase += v.lfo_inc;
                    while v.lfo_phase >= TWO_PI {
                        v.lfo_phase -= TWO_PI;
                    }
                    v.phase += THEREMIN_VIB_DEPTH * v.phase_delta * v.lfo_phase.sin();
                }
                v.phase += v.phase_delta;
                // `while` (not `if`) so the wrap holds even if phase_delta ever
                // exceeds 2π (absurdly high note numbers); normal notes loop once.
                while v.phase >= TWO_PI {
                    v.phase -= TWO_PI;
                }
            }
        }
        sample *= MASTER_GAIN; // headroom: bounds the mix to [-amp, amp] by construction
        for ch in 0..channels {
            out[frame * channels + ch] = sample;
        }
    }
}

/// Apply the user's master volume to an already-rendered buffer, then hard-clamp
/// every sample to [-1, 1].  `gain` is the post-render multiplier (`level *
/// VOLUME_GAIN_MAX`).  The clamp is a limiter: however hard the level is driven,
/// the output is always a valid sample — so the engine cannot emit anything the
/// DAC would wrap or distort, for any number of voices.  Stack-only, alloc-free.
fn apply_master_volume(out: &mut [f32], gain: f32) {
    for s in out.iter_mut() {
        *s = (*s * gain).clamp(-1.0, 1.0);
    }
}

/// Push a note event onto the producer, or drop it and count the drop if the
/// queue is full.  Never blocks, spins, or allocates — safe even though it runs
/// on the (non-real-time) control thread.
fn push_or_drop(producer: &mut NoteProducer, dropped: &AtomicUsize, ev: NoteEvent) {
    if producer.try_push(ev).is_err() {
        dropped.fetch_add(1, Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------
// Public state (Tauri managed)
// ---------------------------------------------------------------------------

/// Shared handles to the audio thread.  Only `Send + Sync` types here —
/// the `cpal::Stream` and the voices are owned exclusively by the audio thread.
pub struct AudioEngine {
    running: Arc<AtomicBool>,
    pub underruns: Arc<AtomicUsize>,
    pub dropped_events: Arc<AtomicUsize>,
    /// Number of voices currently sounding, written once per callback block.
    /// Lets a test prove the engine is actually live and under load (the audio
    /// callback only runs when a device is open), so the glitch gate cannot pass
    /// vacuously on a machine with no output device.
    pub sounding_voices: Arc<AtomicUsize>,
    /// Set true ONLY when there is no default output device.  Lets the gate skip
    /// (when explicitly opted in) for a genuinely deviceless machine while still
    /// hard-failing every other zero-voice cause (stream build/format/play
    /// failure on a device that *is* present).
    pub no_device: Arc<AtomicBool>,
    /// Selected preset index (clamped to `0..PRESET_COUNT`), read once per block by
    /// the audio thread.  Persists across engine restarts (not reset in start/stop).
    preset: Arc<AtomicU8>,
    /// Master volume level in [0, 1] (f32 bits), read once per block by the audio
    /// thread.  Persists across engine restarts.
    volume: Arc<AtomicU32>,
    producer: Mutex<Option<NoteProducer>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            underruns: Arc::new(AtomicUsize::new(0)),
            dropped_events: Arc::new(AtomicUsize::new(0)),
            sounding_voices: Arc::new(AtomicUsize::new(0)),
            no_device: Arc::new(AtomicBool::new(false)),
            preset: Arc::new(AtomicU8::new(0)), // 0 = Sine (default)
            volume: Arc::new(AtomicU32::new(DEFAULT_VOLUME.to_bits())),
            producer: Mutex::new(None),
            thread: Mutex::new(None),
        }
    }

    /// Select a preset (timbre) by index; clamped to a valid preset so any UI
    /// value is safe. Takes effect within one audio block (~11 ms).
    pub fn set_preset(&self, index: u8) {
        let clamped = index.min(PRESET_COUNT as u8 - 1);
        self.preset.store(clamped, Ordering::Relaxed);
    }

    /// Set the master volume level, clamped to [0, 1] so any UI value is safe
    /// (NaN coerces to 0). Takes effect within one audio block (~11 ms).
    pub fn set_volume(&self, level: f32) {
        let clamped = if level.is_nan() {
            0.0
        } else {
            level.clamp(0.0, 1.0)
        };
        self.volume.store(clamped.to_bits(), Ordering::Relaxed);
    }

    /// Start the audio thread (silent until note events arrive).
    /// If already running, this is a no-op.
    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.thread.lock().map_err(|e| e.to_string())?;
        if self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        // Pre-allocate the lock-free event queue ONCE, here on the control
        // thread — never in the audio callback.
        let rb = HeapRb::<NoteEvent>::new(EVENT_QUEUE_CAPACITY);
        let (producer, consumer) = rb.split();
        *self.producer.lock().map_err(|e| e.to_string())? = Some(producer);

        self.running.store(true, Ordering::SeqCst);
        self.underruns.store(0, Ordering::SeqCst);
        self.dropped_events.store(0, Ordering::SeqCst);
        self.sounding_voices.store(0, Ordering::SeqCst);
        self.no_device.store(false, Ordering::SeqCst);

        let running = Arc::clone(&self.running);
        let underruns = Arc::clone(&self.underruns);
        let sounding_voices = Arc::clone(&self.sounding_voices);
        let no_device = Arc::clone(&self.no_device);
        let preset = Arc::clone(&self.preset);
        let volume = Arc::clone(&self.volume);

        let handle = thread::spawn(move || {
            audio_thread(
                running,
                underruns,
                sounding_voices,
                no_device,
                preset,
                volume,
                consumer,
            );
        });

        *guard = Some(handle);
        Ok(())
    }

    /// Signal the audio thread to stop, wait for it to exit, and drop the queue.
    pub fn stop(&self) -> Result<(), String> {
        // Take the thread lock FIRST, then clear `running` while holding it.
        // `start()` also sets `running` under this lock, so the two transitions
        // are serialized — `running` can never disagree with the thread/producer
        // state (otherwise a stop racing an auto-start could wedge the engine at
        // running==true with no thread/producer, silently swallowing all notes).
        let mut guard = self.thread.lock().map_err(|e| e.to_string())?;
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = guard.take() {
            handle
                .join()
                .map_err(|_| "audio thread panicked".to_string())?;
        }
        // Drop the producer so a fresh queue is created on the next start.
        *self.producer.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }

    /// Queue a note event for the audio thread.  Auto-starts the engine on the
    /// first event so the first key press is audible.  Never errors the UI on a
    /// full queue — it drops and counts (see `dropped_events`).
    pub fn send_event(&self, ev: NoteEvent) -> Result<(), String> {
        if !self.running.load(Ordering::SeqCst) {
            self.start()?;
        }
        let mut guard = self.producer.lock().map_err(|e| e.to_string())?;
        if let Some(prod) = guard.as_mut() {
            push_or_drop(prod, &self.dropped_events, ev);
        }
        // If the engine was concurrently torn down (producer == None), the event
        // is dropped here.  That only happens when a note races `stop()` — i.e.
        // engine teardown — where losing an in-flight note is harmless.
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Audio thread entry point
// ---------------------------------------------------------------------------

/// Owns the `cpal::Stream` for its entire lifetime.  Drains note events and
/// renders voices until `running` is cleared, then drops the stream and exits.
fn audio_thread(
    running: Arc<AtomicBool>,
    underruns: Arc<AtomicUsize>,
    sounding_voices: Arc<AtomicUsize>,
    no_device: Arc<AtomicBool>,
    preset: Arc<AtomicU8>,
    volume: Arc<AtomicU32>,
    mut consumer: NoteConsumer,
) {
    let host = cpal::default_host();

    let device = match host.default_output_device() {
        Some(d) => d,
        None => {
            eprintln!("[audio] no default output device — audio thread exiting");
            // Distinguish "no device" from a stream build/play failure below:
            // only this path sets no_device, so the gate can skip here yet still
            // hard-fail every other zero-voice cause.
            no_device.store(true, Ordering::SeqCst);
            running.store(false, Ordering::SeqCst);
            return;
        }
    };

    let default_config = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[audio] failed to get default output config: {e}");
            running.store(false, Ordering::SeqCst);
            return;
        }
    };

    let sample_rate = default_config.sample_rate();
    let channels = default_config.channels() as usize;
    let sr = sample_rate.0 as f32;

    // We build an f32 output stream below. If the device's default format is not
    // f32, bail with a clear message rather than failing opaquely at stream build.
    if default_config.sample_format() != cpal::SampleFormat::F32 {
        eprintln!(
            "[audio] default output format is {:?}, expected f32 — audio thread exiting",
            default_config.sample_format()
        );
        running.store(false, Ordering::SeqCst);
        return;
    }

    // Try to request a 512-frame buffer; fall back to Default if unsupported.
    let buffer_size = match default_config.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => {
            if *min <= PREFERRED_BUFFER_FRAMES && PREFERRED_BUFFER_FRAMES <= *max {
                BufferSize::Fixed(PREFERRED_BUFFER_FRAMES)
            } else {
                eprintln!(
                    "[audio] 512-frame buffer outside supported range [{min},{max}], using default"
                );
                BufferSize::Default
            }
        }
        cpal::SupportedBufferSize::Unknown => BufferSize::Default,
    };

    let config = StreamConfig {
        channels: default_config.channels(),
        sample_rate,
        buffer_size,
    };

    let mut pool = VoicePool::new();
    // Per-preset ADSR table, built once here (alloc allowed) from the real device
    // sample rate; the callback only ever indexes it.
    let adsr_table = build_adsr_table(sr);

    let stream = device.build_output_stream(
        &config,
        move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
            // Wrap in assert_no_alloc so any accidental allocation aborts in
            // debug/test builds.  Compiles to a no-op in release.
            assert_no_alloc(|| {
                // Read the live preset once per block (clamped) — waveform applies
                // to all voices; the envelope is captured per-voice at note-on.
                let i = (preset.load(Ordering::Relaxed) as usize).min(PRESET_COUNT - 1);
                let waveform = PRESETS[i].waveform;
                // Drain all pending note events (pure index math, no alloc/lock).
                while let Some(ev) = consumer.try_pop() {
                    apply_event(&mut pool, ev, sr, i as u8);
                }
                render_block(
                    data,
                    &mut pool.voices,
                    channels,
                    AMPLITUDE,
                    waveform,
                    &adsr_table,
                );
                // Apply the live master volume (read once per block) and limit —
                // the only stage that scales by user gain; the clamp guarantees a
                // valid output sample no matter how hard the level is driven.
                let level = f32::from_bits(volume.load(Ordering::Relaxed));
                apply_master_volume(data, level * VOLUME_GAIN_MAX);
                // Publish how many voices are sounding so a test can confirm the
                // callback actually ran under load (proves the device is live).
                sounding_voices.store(pool.sounding_count(), Ordering::Relaxed);
            });
        },
        // Error callback: on CoreAudio, underruns surface here.
        // Counting invocations is the practical proxy for underrun count.
        {
            let underruns = Arc::clone(&underruns);
            move |err| {
                underruns.fetch_add(1, Ordering::Relaxed);
                eprintln!("[audio] stream error (underrun proxy): {err}");
            }
        },
        None,
    );

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[audio] failed to build output stream: {e}");
            running.store(false, Ordering::SeqCst);
            return;
        }
    };

    if let Err(e) = stream.play() {
        eprintln!("[audio] failed to play stream: {e}");
        running.store(false, Ordering::SeqCst);
        return;
    }

    // Keep the stream alive until `running` is cleared.
    while running.load(Ordering::SeqCst) {
        thread::sleep(std::time::Duration::from_millis(10));
    }

    // `stream` is dropped here, stopping playback cleanly.
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use assert_no_alloc::assert_no_alloc;
    use ringbuf::traits::{Consumer, Producer, Split};
    use ringbuf::HeapRb;

    // K4 changed the production signatures; these test-only shims keep the pre-K4
    // tests terse. `Adsr::new` = the default (Sine) preset's envelope; `render_sine`
    // renders the default waveform with a single-preset table (voices default to
    // preset 0, so they step `adsr`).
    impl Adsr {
        fn new(sample_rate: f32) -> Self {
            Adsr::from_spec(PRESETS[0].adsr, sample_rate)
        }
    }
    fn render_sine(out: &mut [f32], voices: &mut [Voice], channels: usize, amp: f32, adsr: &Adsr) {
        let table = [*adsr; PRESET_COUNT];
        render_block(out, voices, channels, amp, Waveform::Sine, &table);
    }

    const ALL_WAVEFORMS: [Waveform; 8] = [
        Waveform::Sine,
        Waveform::Saw,
        Waveform::Square,
        Waveform::Triangle,
        Waveform::Organ,
        Waveform::EPiano,
        Waveform::Bell,
        Waveform::Theremin,
    ];

    /// Pitch math: f = 440 * 2^((n-69)/12), A4 = 69 = 440 Hz.
    #[test]
    fn note_to_freq_matches_equal_temperament() {
        assert!(
            (note_to_freq(69) - 440.0).abs() < 1e-3,
            "A4 should be 440 Hz"
        );
        assert!(
            (note_to_freq(57) - 220.0).abs() < 1e-3,
            "A3 should be 220 Hz"
        );
        assert!(
            (note_to_freq(81) - 880.0).abs() < 1e-3,
            "A5 should be 880 Hz"
        );
    }

    // --- STORY-K3: polyphony (allocation / stealing / note-off) -------------

    /// Distinct note-ons fan out to separate voices; once the pool is full, the
    /// next note steals the OLDEST (smallest age) voice — deterministically.
    #[test]
    fn voice_allocation_steals_oldest_deterministically() {
        let mut pool = VoicePool::new();
        let sr = 44_100.0;

        // Fill every voice with a distinct note (60, 61, …) in order.
        for k in 0..VOICE_COUNT {
            apply_event(&mut pool, NoteEvent::NoteOn { note: 60 + k as u8 }, sr, 0);
        }
        assert_eq!(pool.sounding_count(), VOICE_COUNT, "pool should be full");
        assert_eq!(pool.voices[0].note, 60, "voices[0] was allocated first");

        // One more distinct note → must steal the oldest (voices[0]), not grow.
        let steal_note = 60 + VOICE_COUNT as u8;
        apply_event(&mut pool, NoteEvent::NoteOn { note: steal_note }, sr, 0);
        assert_eq!(pool.sounding_count(), VOICE_COUNT, "stole, didn't grow");
        assert_eq!(
            pool.voices[0].note, steal_note,
            "oldest voice was re-tasked"
        );
        let max_age = pool.voices.iter().map(|v| v.age).max().unwrap();
        assert_eq!(
            pool.voices[0].age, max_age,
            "stolen voice is now the newest"
        );
    }

    /// Pressing an already-held note reuses its one voice (one note per key) —
    /// it does not allocate a second, detuned-identical voice.
    #[test]
    fn same_note_retrigger_reuses_one_voice() {
        let mut pool = VoicePool::new();
        let sr = 44_100.0;
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 0);
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 0);
        assert_eq!(pool.sounding_count(), 1, "same note must reuse one voice");
    }

    /// Note-off releases the matching voice and leaves the others sounding; a
    /// note-off for a note no voice is playing is a silent no-op.
    #[test]
    fn note_off_releases_matching_voice_and_no_match_is_noop() {
        let mut pool = VoicePool::new();
        let sr = 44_100.0;
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 0);
        apply_event(&mut pool, NoteEvent::NoteOn { note: 64 }, sr, 0);
        apply_event(&mut pool, NoteEvent::NoteOn { note: 67 }, sr, 0);

        apply_event(&mut pool, NoteEvent::NoteOff { note: 64 }, sr, 0);
        let v64 = pool.voices.iter().find(|v| v.note == 64).unwrap();
        assert_eq!(v64.stage, EnvStage::Release, "matching note should release");
        for n in [60u8, 67] {
            let v = pool.voices.iter().find(|v| v.note == n).unwrap();
            assert_ne!(
                v.stage,
                EnvStage::Release,
                "a non-matching voice was released"
            );
        }

        // No-match note-off changes nothing.
        let releasing = |p: &VoicePool| {
            p.voices
                .iter()
                .filter(|v| v.stage == EnvStage::Release)
                .count()
        };
        let before = releasing(&pool);
        apply_event(&mut pool, NoteEvent::NoteOff { note: 99 }, sr, 0);
        assert_eq!(
            before,
            releasing(&pool),
            "note-off for an unplayed note must be a no-op"
        );
    }

    /// A sounding voice renders phase-advancing audio bounded by the single-voice
    /// ceiling (`amp * MASTER_GAIN`); an idle pool renders silence.
    #[test]
    fn render_block_is_bounded_and_advances_sounding_voice() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let adsr = Adsr::new(44_100.0);

        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, 44_100.0, 0);
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        render_sine(&mut buf, &mut pool.voices, CHANNELS, AMPLITUDE, &adsr);

        assert!(pool.voices[0].phase > 0.0, "phase did not advance");
        let ceiling = AMPLITUDE * MASTER_GAIN + 1e-6;
        for &s in buf.iter() {
            assert!(
                s.abs() <= ceiling,
                "sample {s} exceeds single-voice ceiling {ceiling}"
            );
        }
        assert!(
            buf.iter().any(|&s| s.abs() > 1e-6),
            "sounding voice produced silence"
        );

        // Idle pool -> pure silence.
        let mut silent = VoicePool::new();
        let mut buf2 = [0.0f32; FRAMES * CHANNELS];
        render_sine(&mut buf2, &mut silent.voices, CHANNELS, AMPLITUDE, &adsr);
        assert!(buf2.iter().all(|&s| s == 0.0), "idle pool produced sound");
    }

    /// The load-bearing invariant: the *real* callback hot path — drain events
    /// (fill the pool, a same-note reuse, a steal, a matching off, a non-matching
    /// off) via `try_pop` + `apply_event`, then `render_block` over the full
    /// 16-voice mix — allocates nothing. Exercises every `apply_event` path under
    /// the guard.
    #[test]
    fn callback_hot_path_does_not_allocate() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let sr = 44_100.0_f32;

        // Build + fill the queue OUTSIDE the no-alloc region (alloc allowed here).
        let rb = HeapRb::<NoteEvent>::new(EVENT_QUEUE_CAPACITY);
        let (mut producer, mut consumer) = rb.split();
        for k in 0..VOICE_COUNT {
            producer
                .try_push(NoteEvent::NoteOn { note: 60 + k as u8 })
                .unwrap(); // fill the pool
        }
        producer.try_push(NoteEvent::NoteOn { note: 60 }).unwrap(); // same-note reuse
        producer.try_push(NoteEvent::NoteOn { note: 90 }).unwrap(); // force a steal
        producer.try_push(NoteEvent::NoteOff { note: 64 }).unwrap(); // matching off
        producer.try_push(NoteEvent::NoteOff { note: 7 }).unwrap(); // non-matching off

        let mut pool = VoicePool::new();
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        let adsr_table = build_adsr_table(sr);
        let sounding_voices = AtomicUsize::new(0);
        let volume = AtomicU32::new(DEFAULT_VOLUME.to_bits());

        // Mirror the real callback for EVERY waveform: drain + render + volume-limit
        // + publish, all under the no-alloc guard (additive's harmonic loop AND the
        // master-volume post-process included).
        assert_no_alloc(|| {
            while let Some(ev) = consumer.try_pop() {
                apply_event(&mut pool, ev, sr, 1); // capture preset 1 (Organ)
            }
            for wf in ALL_WAVEFORMS {
                render_block(
                    &mut buf,
                    &mut pool.voices,
                    CHANNELS,
                    AMPLITUDE,
                    wf,
                    &adsr_table,
                );
                let level = f32::from_bits(volume.load(Ordering::Relaxed));
                apply_master_volume(&mut buf, level * VOLUME_GAIN_MAX);
            }
            sounding_voices.store(pool.sounding_count(), Ordering::Relaxed);
        });

        // The steal re-tasked the oldest voice to note 90; the evicted oldest
        // note (61) is gone. (The note-off'd voice 64 was released while still at
        // env 0, so it went Idle on the first render sample — correct behavior.)
        assert!(
            pool.voices.iter().any(|v| v.note == 90 && v.is_sounding()),
            "stolen voice should now sound the new note"
        );
        assert!(
            !pool.voices.iter().any(|v| v.note == 61),
            "the evicted (oldest) note should be gone"
        );
    }

    /// Full-queue policy: pushing past capacity never blocks; overflow events are
    /// dropped and counted (the contract `send_event` relies on).
    #[test]
    fn push_or_drop_counts_overflow_without_blocking() {
        let cap = 4;
        let rb = HeapRb::<NoteEvent>::new(cap);
        let (mut producer, _consumer) = rb.split();
        let dropped = AtomicUsize::new(0);

        let total = cap + 5;
        for i in 0..total {
            push_or_drop(&mut producer, &dropped, NoteEvent::NoteOn { note: i as u8 });
        }

        let d = dropped.load(Ordering::Relaxed);
        assert!(d >= 5, "expected >= 5 drops once full, got {d}");
        assert!(d <= total, "dropped more events than were pushed");
    }

    // --- STORY-K2: ADSR envelope --------------------------------------------

    /// A note from silence emits envelope 0 on its first sample (no onset click),
    /// then the attack ramps up.
    #[test]
    fn envelope_attack_from_silence_starts_at_zero_and_rises() {
        let adsr = Adsr::new(44_100.0);
        let mut v = Voice::SILENT;
        v.stage = EnvStage::Attack; // note-on from silence

        let e0 = step_env(&mut v, &adsr);
        assert_eq!(
            e0, 0.0,
            "first envelope sample from silence must be 0 (no click)"
        );
        let e1 = step_env(&mut v, &adsr);
        assert!(e1 > e0, "attack must ramp up");
    }

    /// Release ramps monotonically down to exactly 0, ends in `Idle`, and its tail
    /// is below −60 dBFS — so a note stops without a click.
    #[test]
    fn envelope_release_ramps_to_zero_then_idle() {
        let adsr = Adsr::new(44_100.0);
        let mut v = Voice::SILENT;
        v.env = adsr.sustain;
        v.stage = EnvStage::Release;

        let mut last = 1.0_f32;
        let mut reached_idle = false;
        for _ in 0..1_000_000 {
            let e = step_env(&mut v, &adsr);
            assert!(
                e <= last + 1e-6,
                "release must be monotonically non-increasing"
            );
            last = e;
            if v.stage == EnvStage::Idle {
                reached_idle = true;
                break;
            }
        }
        assert!(reached_idle, "release never reached Idle");
        assert_eq!(v.env, 0.0, "env must be exactly 0 once Idle");
        assert!(
            last < 1e-3,
            "release tail {last} not below -60 dBFS (would click)"
        );
    }

    /// Across a full attack→decay→sustain→release lifecycle the per-sample
    /// envelope step never exceeds the largest configured increment — i.e. there
    /// is no instantaneous jump that would click.
    #[test]
    fn envelope_per_sample_step_is_bounded() {
        let adsr = Adsr::new(44_100.0);
        let max_step = adsr.attack_inc.max(adsr.decay_inc).max(adsr.release_inc) + 1e-6;

        let mut v = Voice::SILENT;
        v.stage = EnvStage::Attack;
        let mut prev = step_env(&mut v, &adsr);
        let mut released = false;

        for _ in 0..1_000_000 {
            // Once we hit sustain, trigger release to exercise that transition too.
            if !released && v.stage == EnvStage::Sustain {
                v.stage = EnvStage::Release;
                released = true;
            }
            let e = step_env(&mut v, &adsr);
            assert!(
                (e - prev).abs() <= max_step,
                "envelope jumped by {} (> {max_step}) — instantaneous step",
                (e - prev).abs()
            );
            prev = e;
            if released && v.stage == EnvStage::Idle {
                break;
            }
        }
        assert!(released, "never reached sustain to exercise release");
    }

    /// The AC's authoritative gate is on the RENDERED OUTPUT (`amp*env*sin`), not
    /// the bare envelope: the first output sample from silence and the last
    /// non-zero output sample after release must both be below −60 dBFS (|x|<1e-3),
    /// so neither the onset nor the release clicks.  Guards `render_block` itself
    /// (which K3 will edit for headroom scaling).
    #[test]
    fn render_block_output_is_declicked_at_note_boundaries() {
        const CH: usize = 1;
        let adsr = Adsr::new(44_100.0);
        let mut pool = VoicePool::new();

        // Onset: first rendered output sample from silence must be ~0.
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, 44_100.0, 0);
        let mut first = [0.0f32; 1];
        render_sine(&mut first, &mut pool.voices, CH, AMPLITUDE, &adsr);
        assert!(
            first[0].abs() < 1e-3,
            "onset click: first output {} not below -60 dBFS",
            first[0]
        );

        // Drive through attack/decay into sustain, then release and render to Idle.
        let mut warm = [0.0f32; 8192];
        render_sine(&mut warm, &mut pool.voices, CH, AMPLITUDE, &adsr);
        apply_event(&mut pool, NoteEvent::NoteOff { note: 69 }, 44_100.0, 0);

        let mut last_nonzero = 0.0f32;
        let mut reached_idle = false;
        for _ in 0..64 {
            let mut block = [0.0f32; 1024];
            render_sine(&mut block, &mut pool.voices, CH, AMPLITUDE, &adsr);
            for &s in block.iter() {
                if s != 0.0 {
                    last_nonzero = s;
                }
            }
            if !pool.voices[0].is_sounding() {
                reached_idle = true;
                break;
            }
        }
        assert!(reached_idle, "voice never released to Idle");
        assert!(
            last_nonzero.abs() < 1e-3,
            "release click: last output {} not below -60 dBFS",
            last_nonzero
        );
    }

    /// Retrigger continuity (the load-bearing comment in `apply_event`): a same-note
    /// note-on reuses the voice and must NOT reset phase or env — otherwise every
    /// retrigger clicks.  Pins the invariant against a future "reset the oscillator
    /// on note-on" edit.
    #[test]
    fn retrigger_keeps_phase_and_env_continuous() {
        const CH: usize = 1;
        let adsr = Adsr::new(44_100.0);
        let mut pool = VoicePool::new();

        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, 44_100.0, 0);
        let mut buf = [0.0f32; 512];
        render_sine(&mut buf, &mut pool.voices, CH, AMPLITUDE, &adsr);
        let phase_before = pool.voices[0].phase;
        let env_before = pool.voices[0].env;
        assert!(
            phase_before > 0.0 && env_before > 0.0,
            "voice should be sounding before the retrigger"
        );

        // Same-note retrigger reuses the voice; phase/env must be continuous.
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, 44_100.0, 0);
        assert_eq!(
            pool.sounding_count(),
            1,
            "same-note retrigger reused one voice"
        );
        assert_eq!(
            pool.voices[0].phase, phase_before,
            "retrigger reset phase (would click)"
        );
        assert_eq!(
            pool.voices[0].env, env_before,
            "retrigger reset env (would click)"
        );
        assert_eq!(
            pool.voices[0].stage,
            EnvStage::Attack,
            "retrigger should re-enter attack"
        );
    }

    // --- STORY-K3: headroom -------------------------------------------------

    /// Headroom by construction: with every voice at full envelope rendering the
    /// LOUDEST waveform (Square = constant ±1, a strictly harder case than sine),
    /// the mix stays within [-1, 1] — clipping is impossible — and the peak reaches
    /// ~AMPLITUDE (the voices really sum). This is the true worst case after K4.
    #[test]
    fn headroom_full_pool_stays_in_bounds() {
        const CH: usize = 1;
        let table = build_adsr_table(44_100.0);
        let mut pool = VoicePool::new();
        for v in pool.voices.iter_mut() {
            v.stage = EnvStage::Decay; // returns env=1.0 on this sample (current-before-advance)
            v.env = 1.0;
            v.phase = std::f32::consts::FRAC_PI_2; // t = 0.25 < 0.5 → Square = +1
            v.phase_delta = 0.0; // hold phase so every sample is the worst case
        }
        let mut buf = [0.0f32; 64];
        render_block(
            &mut buf,
            &mut pool.voices,
            CH,
            AMPLITUDE,
            Waveform::Square,
            &table,
        );

        for &s in buf.iter() {
            assert!(
                (-1.0..=1.0).contains(&s),
                "mix clipped: sample {s} outside [-1, 1]"
            );
        }
        let peak = buf.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!(
            peak > AMPLITUDE - 0.05,
            "full-pool peak {peak} far below the AMPLITUDE ceiling — voices not summing"
        );
    }

    /// The headroom scaling must not crush a lone note to silence.
    #[test]
    fn single_voice_is_audibly_loud() {
        const CH: usize = 1;
        let adsr = Adsr::new(44_100.0);
        let mut pool = VoicePool::new();
        pool.voices[0].stage = EnvStage::Sustain;
        pool.voices[0].env = adsr.sustain;
        pool.voices[0].phase = std::f32::consts::FRAC_PI_2;
        pool.voices[0].phase_delta = 0.0;

        let mut buf = [0.0f32; 16];
        render_sine(&mut buf, &mut pool.voices, CH, AMPLITUDE, &adsr);
        let peak = buf.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!(
            peak > 0.01,
            "single voice peak {peak} too quiet (crushed by headroom)"
        );
    }

    /// A note-off mid-attack (env well below sustain) still releases monotonically
    /// to exactly silence/Idle with bounded steps — rapid taps don't click or stick.
    #[test]
    fn release_from_mid_attack_reaches_silence_monotonically() {
        let adsr = Adsr::new(44_100.0);
        let mut v = Voice::SILENT;
        v.stage = EnvStage::Attack;
        for _ in 0..50 {
            step_env(&mut v, &adsr);
        }
        assert!(
            v.env > 0.0 && v.env < adsr.sustain,
            "should be mid-attack, below sustain"
        );

        v.stage = EnvStage::Release;
        let max_step = adsr.release_inc + 1e-6;
        let mut last = v.env;
        let mut reached_idle = false;
        for _ in 0..1_000_000 {
            let e = step_env(&mut v, &adsr);
            assert!(e <= last + 1e-6, "release not monotonic");
            assert!(last - e <= max_step, "release step exceeded bound");
            last = e;
            if v.stage == EnvStage::Idle {
                reached_idle = true;
                break;
            }
        }
        assert!(
            reached_idle && v.env == 0.0,
            "release from mid-attack did not reach silence"
        );
    }

    // --- STORY-K4: waveforms / presets --------------------------------------

    /// Every waveform stays within [-1, 1] across a dense phase sweep — the
    /// precondition the `MASTER_GAIN` headroom proof relies on.
    #[test]
    fn all_waveforms_bounded() {
        for wf in ALL_WAVEFORMS {
            for i in 0..5000 {
                let phase = (i as f32 / 5000.0) * TWO_PI;
                let s = eval_waveform(wf, phase);
                assert!(
                    s.abs() <= 1.0 + 1e-6,
                    "{wf:?} out of [-1,1] at {phase}: {s}"
                );
            }
        }
    }

    /// Saw ramps monotonically upward within a period (the AC's wording).
    #[test]
    fn waveform_saw_is_monotonic_within_period() {
        let n = 2000;
        let mut prev = f32::NEG_INFINITY;
        for i in 0..n {
            let phase = (i as f32 / n as f32) * (TWO_PI - 1e-3);
            let s = eval_waveform(Waveform::Saw, phase);
            assert!(s >= prev, "saw not monotonic at phase {phase}");
            prev = s;
        }
    }

    /// Square is exactly two-valued (±1) and takes both values.
    #[test]
    fn waveform_square_is_two_valued() {
        let (mut saw_pos, mut saw_neg) = (false, false);
        for i in 0..2000 {
            let phase = (i as f32 / 2000.0) * TWO_PI;
            let s = eval_waveform(Waveform::Square, phase);
            assert!(s == 1.0 || s == -1.0, "square value {s} not ±1");
            if s > 0.0 {
                saw_pos = true;
            } else {
                saw_neg = true;
            }
        }
        assert!(saw_pos && saw_neg, "square should take both ±1 values");
    }

    /// Triangle is -1 at t=0, +1 at t=0.5.
    #[test]
    fn waveform_triangle_shape() {
        assert!(
            (eval_waveform(Waveform::Triangle, 0.0) + 1.0).abs() < 1e-5,
            "triangle at t=0 should be -1"
        );
        assert!(
            (eval_waveform(Waveform::Triangle, std::f32::consts::PI) - 1.0).abs() < 1e-5,
            "triangle at t=0.5 should be +1"
        );
    }

    /// The additive registrations (Organ, EPiano, Bell) stay bounded AND are not
    /// crushed (peak > 0.5), proving the `/NORM` normalisation keeps them audible.
    #[test]
    fn additive_registrations_bounded_and_audible() {
        for wf in [Waveform::Organ, Waveform::EPiano, Waveform::Bell] {
            let mut peak = 0.0f32;
            for i in 0..200_000 {
                let phase = (i as f32 / 200_000.0) * TWO_PI;
                let s = eval_waveform(wf, phase);
                assert!((-1.0..=1.0).contains(&s), "{wf:?} sample {s} out of bounds");
                peak = peak.max(s.abs());
            }
            assert!(peak > 0.5, "{wf:?} peak {peak} too low (over-normalized?)");
        }
    }

    // --- Bell (inharmonic additive synthesis) -------------------------------

    /// The bell registration is bounded by construction: `BELL_NORM` is ≥ the sum
    /// of partial amplitudes, so `bell_at` (and the per-voice render path) can never
    /// leave [-1, 1] — the headroom proof holds for the bell like every other
    /// waveform.
    #[test]
    fn bell_norm_bounds_registration() {
        let sum: f32 = BELL_AMPS.iter().sum();
        assert!(
            BELL_NORM >= sum,
            "BELL_NORM ({BELL_NORM}) must be ≥ Σ|amps| ({sum}) so the bell is bounded"
        );
        // Sweep one period: the normalised waveform never escapes [-1, 1].
        for i in 0..4096 {
            let phase = i as f32 / 4096.0 * TWO_PI;
            let s = bell_at(phase);
            assert!(
                (-1.0..=1.0).contains(&s),
                "bell_at({phase}) = {s} out of range"
            );
        }
    }

    /// The defining cue of a bell is its INHARMONIC spectrum — partials at
    /// non-integer ratios, in particular the minor-third "tierce" (1.2) that gives a
    /// church bell its recognisable colour. Guards against anyone "tidying" the
    /// ratios back to a harmonic (integer) series, which would kill the bell timbre.
    #[test]
    fn bell_ratios_are_inharmonic_with_minor_third() {
        assert!(
            BELL_RATIOS.contains(&1.2),
            "bell must include the minor-third tierce (1.2) — its signature partial"
        );
        let any_noninteger = BELL_RATIOS.iter().any(|r| (r - r.round()).abs() > 1e-6);
        assert!(
            any_noninteger,
            "bell spectrum must be inharmonic (some non-integer ratio), not a harmonic series"
        );
        assert_eq!(
            BELL_AMPS.len(),
            BELL_PARTIALS,
            "amps must cover every partial"
        );
        assert_eq!(
            BELL_RATIOS.len(),
            BELL_PARTIALS,
            "ratios must cover every partial"
        );
    }

    /// A full pool of bell voices at full envelope renders within [-1, 1] — the
    /// per-partial phase-accumulator path is bounded just like `bell_at`.
    #[test]
    fn bell_render_is_bounded() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        for k in 0..VOICE_COUNT {
            apply_event(&mut pool, NoteEvent::NoteOn { note: 48 + k as u8 }, sr, 3);
            // 3 = Bell
        }
        for v in pool.voices.iter_mut() {
            v.stage = EnvStage::Decay; // force full envelope (loudest case)
            v.env = 1.0;
        }
        let mut buf = [0.0f32; 1024];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Bell,
            &table,
        );
        for &s in buf.iter() {
            assert!((-1.0..=1.0).contains(&s), "bell mix clipped: {s}");
        }
    }

    /// Each bell partial advances on its OWN phase accumulator at its ratio's rate,
    /// so a non-integer ratio (e.g. the 1.2 tierce) wraps independently and never
    /// glitches at the 2π boundary. After a render every phase stays in [0, 2π).
    #[test]
    fn bell_partial_phases_stay_wrapped() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 72 }, sr, 3); // a high bell → many wraps
        let mut buf = [0.0f32; 4096];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Bell,
            &table,
        );
        let v = pool.voices.iter().find(|x| x.note == 72).unwrap();
        for (p, &ph) in v.bell_phases.iter().enumerate() {
            assert!(
                (0.0..TWO_PI).contains(&ph),
                "partial {p} phase {ph} not wrapped into [0, 2π)"
            );
        }
    }

    /// The hum (partial 0) is the longest-lived and the main bell envelope decays at
    /// exactly that rate — the invariant the relative per-partial decays depend on.
    #[test]
    fn bell_hum_is_slowest_and_drives_main_env() {
        let max = BELL_T60.iter().cloned().fold(0.0f32, f32::max);
        assert_eq!(
            BELL_T60[0], max,
            "the hum (index 0) must be the slowest partial"
        );
        assert_eq!(BELL_T60_MAX, max, "BELL_T60_MAX must equal the slowest T60");
        assert_eq!(
            PRESETS[3].adsr.decay_secs, BELL_T60_MAX,
            "main bell env must decay at the hum's rate so per-partial decays are relative"
        );
    }

    /// Differential decay: a bright high partial loses far more of its relative gain
    /// than the hum over the same span — the bell's "clang → pure hum" transition.
    /// Without this the inharmonic chord decays uniformly and reads as an organ.
    #[test]
    fn bell_high_partials_decay_faster_than_hum() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 3);
        // Render ~1 s.
        let mut buf = [0.0f32; 4096];
        for _ in 0..((sr as usize) / 4096 + 1) {
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Bell,
                &table,
            );
        }
        let v = pool.voices.iter().find(|x| x.note == 60).unwrap();
        // Hum gain barely moves (relative decay ≈ 1); the top partial (shortest T60)
        // has shed most of its gain.
        assert!(
            v.bell_gain[0] > 0.99,
            "hum relative gain should stay ~1 (was {})",
            v.bell_gain[0]
        );
        assert!(
            v.bell_gain[BELL_PARTIALS - 1] < 0.2,
            "top partial should have decayed sharply after ~1 s (was {})",
            v.bell_gain[BELL_PARTIALS - 1]
        );
        // Monotone in partial index: faster T60 ⇒ less remaining gain.
        for p in 1..BELL_PARTIALS {
            assert!(
                v.bell_gain[p] <= v.bell_gain[p - 1] + 1e-6,
                "partial {p} (T60 {}) should not outlast partial {} (T60 {})",
                BELL_T60[p],
                p - 1,
                BELL_T60[p - 1]
            );
        }
    }

    /// `eval_waveform` is a pure function of phase (no hidden state).
    #[test]
    fn eval_waveform_is_pure() {
        for wf in ALL_WAVEFORMS {
            let p = 1.234_f32;
            assert_eq!(
                eval_waveform(wf, p),
                eval_waveform(wf, p),
                "{wf:?} not pure"
            );
        }
    }

    /// `Adsr::from_spec` computes the expected per-sample increments, and
    /// `release_inc` is > 0 even for the default — the refactor is sound.
    #[test]
    fn adsr_from_spec_computes_expected_increments() {
        let sr = 44_100.0;
        let a = Adsr::from_spec(PRESETS[0].adsr, sr); // Sine: 8/60/0.7/120 ms
        assert!((a.attack_inc - 1.0 / (0.008 * sr)).abs() < 1e-9);
        assert!((a.decay_inc - (1.0 - 0.7) / (0.060 * sr)).abs() < 1e-9);
        assert!((a.release_inc - 1.0 / (0.120 * sr)).abs() < 1e-9);
        assert_eq!(a.sustain, 0.7);
    }

    /// The organ and piano presets are structurally distinct (the basis of the
    /// "audibly distinct" AC).
    #[test]
    fn presets_distinct_organ_vs_piano() {
        assert_eq!(
            PRESETS[1].waveform,
            Waveform::Organ,
            "organ = organ registration"
        );
        assert!(PRESETS[1].adsr.sustain >= 0.8, "organ should sustain");
        assert_eq!(
            PRESETS[2].waveform,
            Waveform::EPiano,
            "piano = e-piano registration"
        );
        assert_eq!(PRESETS[2].adsr.sustain, 0.0, "piano should not sustain");
        assert!(
            PRESETS[2].adsr.decay_secs >= 0.3,
            "piano should decay slowly"
        );
    }

    /// DEBT-017: render-level proof that Organ and Piano are SPECTRALLY distinct,
    /// not just different field values. Renders the same note at the same envelope
    /// through `render_block` with each registration, normalises each by its own
    /// peak (removing amplitude), and asserts the *shapes* differ — so the
    /// "audibly distinct" acceptance is an automated eval, not a by-ear check.
    #[test]
    fn organ_and_piano_render_spectrally_distinct() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let render = |wf: Waveform| {
            let mut pool = VoicePool::new();
            // Same captured envelope (preset 0) for both, so any shape difference is
            // purely the waveform/registration, not the amplitude envelope.
            apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, 0);
            let v = pool.voices.iter_mut().find(|v| v.note == 69).unwrap();
            v.stage = EnvStage::Decay;
            v.env = 1.0;
            let mut buf = [0.0f32; 1024];
            render_block(&mut buf, &mut pool.voices, 1, AMPLITUDE, wf, &table);
            buf
        };
        let organ = render(Waveform::Organ);
        let piano = render(Waveform::EPiano);

        let peak = |b: &[f32; 1024]| b.iter().fold(1e-9f32, |m, &x| m.max(x.abs()));
        let (po, pp) = (peak(&organ), peak(&piano));
        let mut max_shape_diff = 0.0f32;
        for i in 0..1024 {
            let d = (organ[i] / po - piano[i] / pp).abs();
            if d > max_shape_diff {
                max_shape_diff = d;
            }
        }
        assert!(
            max_shape_diff > 0.1,
            "Organ and Piano must render spectrally-distinct shapes (max normalised diff {max_shape_diff})"
        );
    }

    // --- Drums (percussion kit) ---------------------------------------------

    const DRUMS: u8 = 4; // PRESETS index of the Drums kit

    /// A full pool of drum hits (one per pitch class) renders within [-1, 1] — the
    /// headroom proof holds for the kit (every drum source ∈ [-1,1], amp env ≤ 1).
    #[test]
    fn drums_render_is_bounded() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        for note in 60u8..72 {
            apply_event(&mut pool, NoteEvent::NoteOn { note }, sr, DRUMS);
        }
        let mut buf = [0.0f32; 2048];
        for _ in 0..8 {
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Drums,
                &table,
            );
            for &s in buf.iter() {
                assert!((-1.0..=1.0).contains(&s), "drum mix out of range: {s}");
            }
        }
    }

    /// A short drum (closed hat, small τ) frees its voice once its baked amplitude
    /// envelope hits the floor — drums are one-shots that self-free.
    #[test]
    fn drum_voice_self_frees_at_amp_floor() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 61 }, sr, DRUMS); // C# rim (shortest τ)
        assert_eq!(pool.sounding_count(), 1);
        let mut buf = [0.0f32; 4096]; // ~93 ms — past the rim's ~55 ms decay-to-floor
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Drums,
            &table,
        );
        assert_eq!(
            pool.sounding_count(),
            0,
            "a rim voice should have self-freed after its short decay"
        );
    }

    /// Drums ignore note-off (one-shot): a key-up must NOT choke the hit into Release.
    #[test]
    fn drums_ignore_note_off() {
        let sr = 44_100.0;
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, DRUMS); // kick
        apply_event(&mut pool, NoteEvent::NoteOff { note: 60 }, sr, DRUMS);
        let v = pool.voices.iter().find(|v| v.note == 60).unwrap();
        assert!(
            v.is_sounding(),
            "drum hit should keep sounding after note-off"
        );
        assert_ne!(
            v.stage,
            EnvStage::Release,
            "drum note-off must not trigger Release"
        );
    }

    /// Different keys are different drums: a kick (C, tonal low) and a snare
    /// (D, noisy) render audibly different output.
    #[test]
    fn drums_kick_and_snare_differ() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let render = |note: u8| {
            let mut pool = VoicePool::new();
            apply_event(&mut pool, NoteEvent::NoteOn { note }, sr, DRUMS);
            let mut buf = [0.0f32; 1024];
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Drums,
                &table,
            );
            buf
        };
        let kick = render(60); // C  → pitch-swept sine
        let snare = render(62); // D → noise + tone
        let diff: f32 = kick
            .iter()
            .zip(snare.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        assert!(
            diff > 1.0,
            "kick and snare should render differently (Σ|Δ| = {diff})"
        );
    }

    /// The drum render path is allocation-free (xorshift noise + sines, no heap) —
    /// across ALL 12 pitch classes (every `drum_source` arm: tones, snare/ride
    /// tone+noise mix, cowbell square, bright-noise hats/crash/clap/rim).
    #[test]
    fn drum_render_does_not_allocate() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        for note in 60u8..72 {
            apply_event(&mut pool, NoteEvent::NoteOn { note }, sr, DRUMS);
        }
        let mut buf = [0.0f32; 512];
        assert_no_alloc(|| {
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Drums,
                &table,
            );
        });
    }

    /// Regression for the zombie-voice defect: a struck drum must keep decaying and
    /// self-free even when the live block waveform is no longer Drums (user switched
    /// preset mid-tail). Drums dispatch per-voice (by captured preset), so the voice
    /// must still reach Idle and not strand a slot / leak a DC term.
    #[test]
    fn drum_voice_frees_after_preset_switch() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 61 }, sr, DRUMS); // rim (short τ)
        assert_eq!(pool.sounding_count(), 1);
        // Render with a NON-Drums live waveform (as if the user switched to Saw).
        let mut buf = [0.0f32; 4096];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Saw,
            &table,
        );
        assert_eq!(
            pool.sounding_count(),
            0,
            "a drum voice must self-free even after a preset switch (no stranded slot / DC)"
        );
    }

    /// Bright-noise drums (hats) are high-frequency-dominant — guards against a
    /// future "tidy" silently dropping the high-pass that fixed the by-ear rejection.
    /// A bright hat flips sign far more often than a low pitched drum (kick).
    #[test]
    fn drum_hat_is_brighter_than_kick() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let sign_changes = |note: u8| {
            let mut pool = VoicePool::new();
            apply_event(&mut pool, NoteEvent::NoteOn { note }, sr, DRUMS);
            let mut buf = [0.0f32; 1024];
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Drums,
                &table,
            );
            buf.windows(2)
                .filter(|w| w[0].signum() != w[1].signum())
                .count()
        };
        let hat = sign_changes(66); // F# closed hat (bright noise)
        let kick = sign_changes(60); // C kick (low sine)
        assert!(
            hat > kick * 5,
            "hat should be far brighter (more sign changes) than kick — hat={hat}, kick={kick}"
        );
    }

    // --- Theremin -----------------------------------------------------------

    const THEREMIN: u8 = 5; // PRESETS index of the Theremin

    /// The Theremin preset is a soft swell (no percussive onset) on the warm-sine
    /// waveform — that envelope is half its character.
    #[test]
    fn theremin_preset_is_a_soft_swell() {
        assert_eq!(PRESETS[THEREMIN as usize].waveform, Waveform::Theremin);
        assert!(
            PRESETS[THEREMIN as usize].adsr.attack_secs >= 0.05,
            "theremin should swell in, not click"
        );
        assert!(
            PRESETS[THEREMIN as usize].adsr.sustain >= 0.8,
            "theremin sustains"
        );
    }

    /// A Theremin note arms the vibrato LFO and the LFO actually modulates the
    /// accumulated phase — the wobble that defines the timbre (and the guard against
    /// a future change silently dropping it).
    #[test]
    fn theremin_vibrato_modulates_the_phase() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, THEREMIN);
        let pd = pool
            .voices
            .iter()
            .find(|v| v.note == 69)
            .unwrap()
            .phase_delta;
        assert!(
            pool.voices.iter().find(|v| v.note == 69).unwrap().lfo_inc > 0.0,
            "a theremin note must arm the vibrato LFO"
        );

        // Render ~a quarter vibrato period so the LFO's contribution is non-zero.
        let mut buf = [0.0f32; 2000];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Theremin,
            &table,
        );

        let v = pool.voices.iter().find(|x| x.note == 69).unwrap();
        assert!(v.lfo_phase > 0.0, "the vibrato LFO should have advanced");
        // Without vibrato the phase would be exactly phase_delta·N (mod 2π); vibrato
        // perturbs it. Compare circularly.
        let expected_no_vib = (pd * 2000.0).rem_euclid(TWO_PI);
        let raw = (v.phase - expected_no_vib).abs();
        let diff = raw.min(TWO_PI - raw);
        assert!(
            diff > 0.05,
            "vibrato should perturb the accumulated phase (diff={diff})"
        );
    }

    /// Regression: a non-Theremin note-on must reset the vibrato phase, so a voice
    /// slot reused from a prior theremin note can't carry a stale `lfo_phase` that
    /// would become a constant DC pitch detune (sin(lfo_phase) frozen ≠ 0).
    #[test]
    fn non_theremin_note_resets_vibrato_phase() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        // Play a theremin note and render so its LFO phase advances to non-zero.
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, THEREMIN);
        let mut buf = [0.0f32; 1000];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Theremin,
            &table,
        );
        assert!(pool.voices.iter().find(|v| v.note == 69).unwrap().lfo_phase > 0.0);

        // Reuse the SAME slot (same-note alloc) for a non-theremin (Sine) note.
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, 0);
        let v = pool.voices.iter().find(|x| x.note == 69).unwrap();
        assert_eq!(v.lfo_inc, 0.0, "non-theremin note must not arm the LFO");
        assert_eq!(
            v.lfo_phase, 0.0,
            "non-theremin note must reset lfo_phase (no stale vibrato detune)"
        );
    }

    /// Behaviour-level proof (not just the lfo_phase state): a reused Sine voice,
    /// rendered while the LIVE waveform is Theremin (the exact bug condition), must
    /// advance its phase by exactly phase_delta·N — i.e. ZERO vibrato detune.
    #[test]
    fn reused_voice_has_no_vibrato_detune_under_theremin_global() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, THEREMIN);
        let mut warm = [0.0f32; 1000];
        render_block(
            &mut warm,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Theremin,
            &table,
        );
        // Reuse the slot for a Sine note (resets lfo_phase), then render UNDER the
        // Theremin global so the vibrato block runs — a stale phase would detune it.
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, 0);
        let (pd, p0) = {
            let v = pool.voices.iter().find(|x| x.note == 69).unwrap();
            (v.phase_delta, v.phase)
        };
        const N: usize = 1000;
        let mut buf = [0.0f32; N];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Theremin,
            &table,
        );
        let v = pool.voices.iter().find(|x| x.note == 69).unwrap();
        let expected = (p0 + pd * N as f32).rem_euclid(TWO_PI);
        let raw = (v.phase - expected).abs();
        let diff = raw.min(TWO_PI - raw);
        assert!(
            diff < 1e-3,
            "a non-theremin reused voice must get NO vibrato nudge (phase off by {diff})"
        );
    }

    /// The piano preset's release reaches exact silence/Idle despite sustain == 0
    /// — guards the `release_inc = 1/release_secs` fix (a `sustain/release` rate
    /// would be 0 here and strand the voice forever).
    #[test]
    fn piano_preset_release_reaches_silence_despite_zero_sustain() {
        let piano = Adsr::from_spec(PRESETS[2].adsr, 44_100.0);
        assert_eq!(piano.sustain, 0.0);
        assert!(
            piano.release_inc > 0.0,
            "release_inc must be > 0 even at sustain 0"
        );
        let mut v = Voice::SILENT;
        v.stage = EnvStage::Release;
        v.env = 0.5; // released mid-decay
        let mut reached_idle = false;
        for _ in 0..1_000_000 {
            step_env(&mut v, &piano);
            if v.stage == EnvStage::Idle {
                reached_idle = true;
                break;
            }
        }
        assert!(
            reached_idle && v.env == 0.0,
            "piano voice never reached silence"
        );
    }

    /// Exponential decay (the piano) stays in [0,1], is monotonically decreasing,
    /// and snaps to Idle/0 at the floor — so the geometric tail still frees the voice.
    #[test]
    fn piano_exp_decay_stays_in_unit_interval_and_reaches_idle() {
        assert_eq!(PRESETS[2].adsr.shape, EnvShape::Exponential);
        let piano = Adsr::from_spec(PRESETS[2].adsr, 44_100.0);
        let mut v = Voice::SILENT;
        v.stage = EnvStage::Decay;
        v.env = 1.0;
        let mut prev = 2.0f32;
        let mut reached_idle = false;
        for _ in 0..2_000_000 {
            let e = step_env(&mut v, &piano);
            assert!((0.0..=1.0).contains(&e), "exp decay env {e} out of [0,1]");
            assert!(e <= prev, "exp decay must be monotonically non-increasing");
            prev = e;
            if v.stage == EnvStage::Idle {
                reached_idle = true;
                break;
            }
        }
        assert!(
            reached_idle && v.env == 0.0,
            "exp decay never reached Idle/0"
        );
    }

    /// Exponential decay drops faster in the first 200 ms than a linear decay of the
    /// same nominal time — the concave "fast initial drop" that reads as a struck string.
    #[test]
    fn exp_decay_drops_faster_initially_than_linear() {
        let sr = 44_100.0;
        let exp = Adsr::from_spec(PRESETS[2].adsr, sr); // piano: exponential
                                                        // A linear decay of the SAME nominal time, for a fair shape comparison.
        let lin = Adsr::from_spec(
            AdsrSpec {
                attack_secs: 0.003,
                decay_secs: PRESETS[2].adsr.decay_secs,
                sustain: 0.0,
                release_secs: 0.18,
                shape: EnvShape::Linear,
            },
            sr,
        );
        let env_after_200ms = |adsr: &Adsr| {
            let mut v = Voice::SILENT;
            v.stage = EnvStage::Decay;
            v.env = 1.0;
            for _ in 0..(0.2 * sr) as usize {
                step_env(&mut v, adsr);
            }
            v.env
        };
        let e = env_after_200ms(&exp);
        let l = env_after_200ms(&lin);
        assert!(
            e < l,
            "exponential decay should drop faster initially than linear ({e} vs {l})"
        );
    }

    /// `set_preset` clamps any index into a valid preset (no panic, no OOB).
    #[test]
    fn set_preset_clamps_out_of_range() {
        let engine = AudioEngine::new();
        engine.set_preset(250);
        assert_eq!(
            engine.preset.load(Ordering::Relaxed),
            PRESET_COUNT as u8 - 1,
            "out-of-range index should clamp to the last preset"
        );
        engine.set_preset(1);
        assert_eq!(engine.preset.load(Ordering::Relaxed), 1);
    }

    /// `set_volume` clamps to [0, 1] (and maps NaN to 0) so any UI value is safe,
    /// and the engine boots at the louder default.
    #[test]
    fn set_volume_clamps_and_defaults() {
        let engine = AudioEngine::new();
        assert_eq!(
            f32::from_bits(engine.volume.load(Ordering::Relaxed)),
            DEFAULT_VOLUME,
            "engine should boot at the default level"
        );
        let level = |e: &AudioEngine| f32::from_bits(e.volume.load(Ordering::Relaxed));

        engine.set_volume(2.5);
        assert_eq!(level(&engine), 1.0, "above-range level clamps to 1.0");
        engine.set_volume(-1.0);
        assert_eq!(level(&engine), 0.0, "below-range level clamps to 0.0");
        engine.set_volume(0.42);
        assert!(
            (level(&engine) - 0.42).abs() < 1e-7,
            "in-range level is kept"
        );
        engine.set_volume(f32::NAN);
        assert_eq!(
            level(&engine),
            0.0,
            "NaN coerces to 0 (mute), never propagates"
        );
    }

    /// The master limiter scales below full scale and HARD-clamps above it — so the
    /// engine can never emit an out-of-range sample however hard the level is driven.
    #[test]
    fn master_volume_scales_then_clamps() {
        // Below the ceiling: linear scaling.
        let mut buf = [0.5f32, -0.5, 0.25, -0.25];
        apply_master_volume(&mut buf, 1.5);
        assert!((buf[0] - 0.75).abs() < 1e-6);
        assert!((buf[1] + 0.75).abs() < 1e-6);

        // Driven hard: every sample is clamped into [-1, 1], none escapes.
        let mut hot = [0.9f32, -0.9, 0.4, -0.7, 1.0, -1.0];
        apply_master_volume(&mut hot, VOLUME_GAIN_MAX); // ~20×
        for &s in hot.iter() {
            assert!((-1.0..=1.0).contains(&s), "limiter let {s} escape [-1, 1]");
        }
        assert_eq!(hot[0], 1.0, "a loud positive sample pins to +1");
        assert_eq!(hot[1], -1.0, "a loud negative sample pins to -1");
    }

    /// The volume mapping is calibrated so `level == 1.0` brings a single full voice
    /// (which `render_block` attenuates to `AMPLITUDE * MASTER_GAIN`) up to ±1.0 —
    /// i.e. the knob reads as single-note peak amplitude.
    #[test]
    fn level_one_brings_a_single_voice_to_full_scale() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 69 }, sr, 0); // one Sine voice
        let v = pool.voices.iter_mut().find(|v| v.note == 69).unwrap();
        v.stage = EnvStage::Decay; // force full envelope
        v.env = 1.0;
        v.phase = std::f32::consts::FRAC_PI_2; // sin = 1 → the voice's peak sample

        let mut buf = [0.0f32; 1];
        render_block(
            &mut buf,
            &mut pool.voices,
            1,
            AMPLITUDE,
            Waveform::Sine,
            &table,
        );
        // Pre-volume, the single voice peaks at AMPLITUDE * MASTER_GAIN.
        assert!((buf[0] - AMPLITUDE * MASTER_GAIN).abs() < 1e-4);
        apply_master_volume(&mut buf, 1.0 * VOLUME_GAIN_MAX);
        assert!(
            (buf[0] - 1.0).abs() < 1e-3,
            "level 1.0 should bring a single full voice to ±1.0, got {}",
            buf[0]
        );
    }

    /// Switching the waveform changes the rendered output (the audible-timbre AC),
    /// while phase stays continuous.
    #[test]
    fn switching_waveform_changes_rendered_output() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mk = || {
            let mut p = VoicePool::new();
            apply_event(&mut p, NoteEvent::NoteOn { note: 69 }, sr, 0);
            p
        };
        let (mut a, mut b) = (mk(), mk());
        let mut sine = [0.0f32; 256];
        let mut saw = [0.0f32; 256];
        render_block(
            &mut sine,
            &mut a.voices,
            1,
            AMPLITUDE,
            Waveform::Sine,
            &table,
        );
        render_block(&mut saw, &mut b.voices, 1, AMPLITUDE, Waveform::Saw, &table);
        assert!(
            sine.iter()
                .zip(saw.iter())
                .any(|(x, y)| (x - y).abs() > 1e-4),
            "sine and saw should produce different output"
        );
    }

    /// The envelope is captured per-voice at note-on: a note keeps its preset's
    /// envelope even after a later note-on captures a different preset (and the
    /// capture happens on every alloc path, including a steal).
    #[test]
    fn preset_envelope_is_captured_per_voice_at_note_on() {
        let sr = 44_100.0;
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 2); // Piano
        assert_eq!(pool.voices.iter().find(|v| v.note == 60).unwrap().preset, 2);

        apply_event(&mut pool, NoteEvent::NoteOn { note: 64 }, sr, 1); // Organ
        assert_eq!(pool.voices.iter().find(|v| v.note == 64).unwrap().preset, 1);
        // The first voice kept its captured (Piano) preset.
        assert_eq!(pool.voices.iter().find(|v| v.note == 60).unwrap().preset, 2);
    }

    /// Render-level proof of the per-voice envelope split: two voices with
    /// DIFFERENT captured presets, stepped in the SAME render_block call, follow
    /// DIFFERENT envelopes — a Piano voice (sustain 0) decays to silence while an
    /// Organ voice (sustain 0.85) holds. Kills a regression that steps every voice
    /// with a single (e.g. `adsr_table[0]`) envelope — which the field-only test
    /// above cannot catch.
    #[test]
    fn per_voice_envelope_renders_distinct_sustains() {
        let sr = 44_100.0;
        let table = build_adsr_table(sr);
        let mut pool = VoicePool::new();
        apply_event(&mut pool, NoteEvent::NoteOn { note: 60 }, sr, 2); // Piano: sustain 0
        apply_event(&mut pool, NoteEvent::NoteOn { note: 64 }, sr, 1); // Organ: sustain 0.85

        // Render ~1.5 s so both pass attack+decay into sustain (Piano decay = 600 ms).
        let mut buf = [0.0f32; 4096];
        for _ in 0..16 {
            render_block(
                &mut buf,
                &mut pool.voices,
                1,
                AMPLITUDE,
                Waveform::Sine,
                &table,
            );
        }

        let piano_env = pool.voices.iter().find(|v| v.note == 60).unwrap().env;
        let organ_env = pool.voices.iter().find(|v| v.note == 64).unwrap().env;
        assert!(
            piano_env < 0.05,
            "piano voice (sustain 0) should decay to silence, env={piano_env}"
        );
        assert!(
            organ_env > 0.7,
            "organ voice should sustain near 0.85, env={organ_env}"
        );
    }
}
