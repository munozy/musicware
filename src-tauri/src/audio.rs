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
//! triangle / additive), each bounded to [-1, 1] so the headroom proof holds for
//! any waveform.  A `Preset` bundles a waveform with an `AdsrSpec`; the selected
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
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Per-voice peak amplitude.  Also the hard output ceiling: because the summed
/// voices are scaled by `MASTER_GAIN = 1/VOICE_COUNT`, the mix peaks at exactly
/// `AMPLITUDE` even with all voices at full envelope and in phase (see `render_block`).
/// 0.8 keeps single notes audible while leaving headroom below full scale (1.0).
const AMPLITUDE: f32 = 0.8;

/// Preferred buffer size in frames (512 ≈ 11 ms at 44.1 kHz).
const PREFERRED_BUFFER_FRAMES: u32 = 512;

/// Number of simultaneous voices (polyphony).  POC-003 validated 16 at ~4% of
/// the 512-frame budget.  Allocation/stealing/headroom are all written in terms
/// of this constant, so it is a one-line change.
pub const VOICE_COUNT: usize = 16;

/// Headroom scale applied to the summed voices.  Each voice contributes at most
/// `AMPLITUDE`, so `sum(N voices) * MASTER_GAIN <= AMPLITUDE < 1.0` for any N and
/// any phases — the mix can never clip, and the scale is constant so there is no
/// zipper/pumping as voices enter and leave.
const MASTER_GAIN: f32 = 1.0 / VOICE_COUNT as f32;

/// Capacity of the note-event queue.  Drained every ~11 ms block, so steady-state
/// occupancy is ~0–2; 256 gives orders-of-magnitude headroom against a burst.
const EVENT_QUEUE_CAPACITY: usize = 256;

const TWO_PI: f32 = 2.0 * std::f32::consts::PI;

// ---------------------------------------------------------------------------
// Waveforms (STORY-K4)
// ---------------------------------------------------------------------------

/// Oscillator shape.  `Copy` so it crosses the callback boundary by value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Saw,
    Square,
    Triangle,
    Additive,
}

/// Drawbar-style 1/k harmonic amplitudes for the additive (organ-ish) waveform.
const ADDITIVE_AMPS: [f32; 8] = [
    1.0,
    1.0 / 2.0,
    1.0 / 3.0,
    1.0 / 4.0,
    1.0 / 5.0,
    1.0 / 6.0,
    1.0 / 7.0,
    1.0 / 8.0,
];
/// Σ of the partial amplitudes (rounded *up* past the f32 sum of `ADDITIVE_AMPS`).
/// Dividing the raw sum by this maps the additive waveform into [-1, 1] *by
/// construction* (|Σ aₖ·sin| ≤ Σ aₖ ≤ NORM), preserving the headroom proof
/// regardless of how the amplitudes are later retuned. (True Σ 1/k for k=1..=8 ≈
/// 2.7178571; rounded up so the bound is provably ≤ 1.0 even with f32 rounding.)
const ADDITIVE_NORM: f32 = 2.717_858;

/// Evaluate a waveform at `phase ∈ [0, 2π)`.  Pure function of phase; every
/// branch returns strictly within [-1, 1] (the precondition the `MASTER_GAIN`
/// headroom proof depends on).
///
/// DEBT: these are *naive* (not band-limited) oscillators — Saw and Square alias
/// audibly on high notes (harmonics fold past Nyquist). Acceptable/instructive for
/// a C3–C5 learning keyboard; band-limiting (PolyBLEP / wavetable) is a future story.
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
        Waveform::Additive => {
            let mut sum = 0.0f32;
            for k in 1..=ADDITIVE_AMPS.len() {
                sum += ADDITIVE_AMPS[k - 1] * (k as f32 * phase).sin();
            }
            sum / ADDITIVE_NORM
        }
    }
}

// ---------------------------------------------------------------------------
// Presets (STORY-K4): a waveform + an envelope, selectable live
// ---------------------------------------------------------------------------

/// Sample-rate-independent ADSR spec (times in seconds).  Built into the
/// per-sample `Adsr` via `Adsr::from_spec`.
#[derive(Clone, Copy)]
struct AdsrSpec {
    attack_secs: f32,
    decay_secs: f32,
    sustain: f32,
    release_secs: f32,
}

/// A timbre: an oscillator waveform plus its envelope shape. (Display names live
/// in the UI; presets are referenced by index here.)
#[derive(Clone, Copy)]
struct Preset {
    waveform: Waveform,
    adsr: AdsrSpec,
}

pub const PRESET_COUNT: usize = 3;

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
        },
    },
    // 1: "Organ" — rich additive + high sustain → a held, harmonically-warm drone.
    Preset {
        waveform: Waveform::Additive,
        adsr: AdsrSpec {
            attack_secs: 0.010,
            decay_secs: 0.040,
            sustain: 0.85,
            release_secs: 0.150,
        },
    },
    // 2: "Piano" — triangle + percussive ADSR (sustain 0, long decay) → plucks and
    // fades while the key is held, unmistakably distinct from the organ.
    Preset {
        waveform: Waveform::Triangle,
        adsr: AdsrSpec {
            attack_secs: 0.003,
            decay_secs: 0.600,
            sustain: 0.0,
            release_secs: 0.200,
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
    attack_inc: f32,  // env rise per sample during attack
    decay_inc: f32,   // env fall per sample during decay
    release_inc: f32, // env fall per sample during release
    sustain: f32,
}

impl Adsr {
    /// Build per-sample increments from a sample-rate-independent spec.
    /// `release_inc` ramps from full scale (1.0) to 0 over `release_secs` — so it
    /// reaches silence from *any* level, including a `sustain` of 0 (a release
    /// rate of `sustain/release` would be 0 there and never free the voice).
    fn from_spec(spec: AdsrSpec, sample_rate: f32) -> Self {
        Self {
            attack_inc: 1.0 / (spec.attack_secs * sample_rate).max(1.0),
            decay_inc: (1.0 - spec.sustain) / (spec.decay_secs * sample_rate).max(1.0),
            release_inc: 1.0 / (spec.release_secs * sample_rate).max(1.0),
            sustain: spec.sustain,
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
        EnvStage::Decay => {
            voice.env -= adsr.decay_inc;
            if voice.env <= adsr.sustain {
                voice.env = adsr.sustain;
                voice.stage = EnvStage::Sustain;
            }
        }
        EnvStage::Sustain => {
            voice.env = adsr.sustain;
        }
        EnvStage::Release => {
            voice.env -= adsr.release_inc;
            if voice.env <= 0.0 {
                voice.env = 0.0;
                voice.stage = EnvStage::Idle;
            }
        }
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
                sample += amp * env * eval_waveform(waveform, v.phase);
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

        let handle = thread::spawn(move || {
            audio_thread(
                running,
                underruns,
                sounding_voices,
                no_device,
                preset,
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

    const ALL_WAVEFORMS: [Waveform; 5] = [
        Waveform::Sine,
        Waveform::Saw,
        Waveform::Square,
        Waveform::Triangle,
        Waveform::Additive,
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

        // Mirror the real callback for EVERY waveform: drain + render + publish,
        // all under the no-alloc guard (additive's harmonic loop included).
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

    /// The additive waveform stays bounded AND is not crushed (peak > 0.5),
    /// proving the `/ADDITIVE_NORM` normalization keeps it audible.
    #[test]
    fn waveform_additive_is_bounded_and_audible() {
        let mut peak = 0.0f32;
        for i in 0..200_000 {
            let phase = (i as f32 / 200_000.0) * TWO_PI;
            let s = eval_waveform(Waveform::Additive, phase);
            assert!((-1.0..=1.0).contains(&s), "additive {s} out of bounds");
            peak = peak.max(s.abs());
        }
        assert!(
            peak > 0.5,
            "additive peak {peak} too low (over-normalized?)"
        );
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
        assert_eq!(PRESETS[1].waveform, Waveform::Additive, "organ = additive");
        assert!(PRESETS[1].adsr.sustain >= 0.8, "organ should sustain");
        assert_eq!(PRESETS[2].waveform, Waveform::Triangle, "piano = triangle");
        assert_eq!(PRESETS[2].adsr.sustain, 0.0, "piano should not sustain");
        assert!(
            PRESETS[2].adsr.decay_secs >= 0.3,
            "piano should decay slowly"
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
