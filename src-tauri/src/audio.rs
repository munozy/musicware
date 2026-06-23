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
//! Voice model
//! ===========
//! K1 is monophonic: a fixed `[Voice; VOICE_COUNT]` array with `VOICE_COUNT = 1`.
//! K3 (polyphony) is literally bumping that constant plus a voice-allocation
//! helper — the render loop already iterates the array.
//!
//! Envelope (STORY-K2)
//! ===================
//! Each voice has a linear **ADSR** amplitude envelope.  A note-on starts the
//! attack; a note-off starts the release; the voice goes silent (stage `Idle`)
//! only when the release reaches zero.  The envelope ramps the amplitude in and
//! out, so notes no longer click on note-on/note-off.  Each sample's output is
//! `amp * envelope * sin(phase)`; the per-sample envelope step is bounded (no
//! instantaneous jump), and a note from silence starts at envelope 0.
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
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Amplitude chosen low enough to avoid a harsh tone.
const AMPLITUDE: f32 = 0.15;

/// Preferred buffer size in frames (512 ≈ 11 ms at 44.1 kHz).
const PREFERRED_BUFFER_FRAMES: u32 = 512;

/// Number of simultaneous voices.  K1 = 1 (mono).  K3 polyphony bumps this AND
/// teaches `apply_event` real voice allocation/stealing (today it hardcodes
/// `voices[0]`, so bumping this constant alone would stay monophonic).
const VOICE_COUNT: usize = 1;

/// Capacity of the note-event queue.  Drained every ~11 ms block, so steady-state
/// occupancy is ~0–2; 256 gives orders-of-magnitude headroom against a burst.
const EVENT_QUEUE_CAPACITY: usize = 256;

const TWO_PI: f32 = 2.0 * std::f32::consts::PI;

// ADSR envelope (STORY-K2). Fixed constants for this slice — no UI control yet.
// Times in seconds; per-sample increments are derived from the device sample rate.
const ATTACK_SECS: f32 = 0.008; // ~8 ms — short enough to feel instant, long enough to de-click
const DECAY_SECS: f32 = 0.060; // ~60 ms
const SUSTAIN_LEVEL: f32 = 0.7; // sustain amplitude (0..1)
const RELEASE_SECS: f32 = 0.120; // ~120 ms

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
    env: f32, // current envelope amplitude, 0..1
}

impl Voice {
    const SILENT: Voice = Voice {
        phase: 0.0,
        phase_delta: 0.0,
        note: 0,
        stage: EnvStage::Idle,
        env: 0.0,
    };

    /// Is this voice contributing sound (anything but fully released)?
    fn is_sounding(&self) -> bool {
        self.stage != EnvStage::Idle
    }
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
    fn new(sample_rate: f32) -> Self {
        Self {
            attack_inc: 1.0 / (ATTACK_SECS * sample_rate).max(1.0),
            decay_inc: (1.0 - SUSTAIN_LEVEL) / (DECAY_SECS * sample_rate).max(1.0),
            release_inc: SUSTAIN_LEVEL / (RELEASE_SECS * sample_rate).max(1.0),
            sustain: SUSTAIN_LEVEL,
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

/// Apply one note event to the voices.  K1: monophonic, last-note priority — a
/// new note-on takes the single voice; a note-off only releases it if it matches
/// the sounding note.  (K3 replaces this with real voice allocation/stealing;
/// the signature over a `&mut [Voice]` slice stays the same.)
fn apply_event(voices: &mut [Voice], ev: NoteEvent, sample_rate: f32) {
    match ev {
        NoteEvent::NoteOn { note } => {
            let v = &mut voices[0];
            v.note = note;
            v.phase_delta = TWO_PI * note_to_freq(note) / sample_rate;
            v.stage = EnvStage::Attack;
            // Neither phase nor env is reset: both stay continuous so retriggering
            // an already-sounding voice has no waveform or amplitude jump (the
            // attack simply ramps from the current env up to 1).  From silence the
            // env is already 0, so the attack starts at 0 — no onset click.
        }
        NoteEvent::NoteOff { note } => {
            let v = &mut voices[0];
            if v.is_sounding() && v.note == note {
                v.stage = EnvStage::Release;
                // K1 simplification (within the AC's "mono / last-note priority"):
                // releasing the sounding note releases the voice; it does NOT fall
                // back to an older still-held key.  A held-note stack is a later
                // enhancement.
            }
        }
    }
}

/// Fill `out` with interleaved samples by summing every sounding voice, each
/// shaped by its ADSR envelope (`amp * env * sin(phase)`).
///
/// Stack-only: no allocations, no locks — safe to call from a real-time callback.
/// For K1/K2 (one voice) the sum stays within `[-amp, amp]` because `env` ≤ 1;
/// K3 adds headroom scaling for many simultaneous voices.
fn render_block(out: &mut [f32], voices: &mut [Voice], channels: usize, amp: f32, adsr: &Adsr) {
    // cpal always delivers whole interleaved frames, so `out.len()` is a multiple
    // of `channels`; the integer division below therefore drops nothing.
    let frame_count = out.len() / channels.max(1);
    for frame in 0..frame_count {
        let mut sample = 0.0f32;
        for v in voices.iter_mut() {
            if v.is_sounding() {
                let env = step_env(v, adsr);
                sample += amp * env * v.phase.sin();
                v.phase += v.phase_delta;
                // `while` (not `if`) so the wrap holds even if phase_delta ever
                // exceeds 2π (absurdly high note numbers); normal notes loop once.
                while v.phase >= TWO_PI {
                    v.phase -= TWO_PI;
                }
            }
        }
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
            producer: Mutex::new(None),
            thread: Mutex::new(None),
        }
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

        let running = Arc::clone(&self.running);
        let underruns = Arc::clone(&self.underruns);

        let handle = thread::spawn(move || {
            audio_thread(running, underruns, consumer);
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
fn audio_thread(running: Arc<AtomicBool>, underruns: Arc<AtomicUsize>, mut consumer: NoteConsumer) {
    let host = cpal::default_host();

    let device = match host.default_output_device() {
        Some(d) => d,
        None => {
            eprintln!("[audio] no default output device — audio thread exiting");
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

    let mut voices = [Voice::SILENT; VOICE_COUNT];
    let adsr = Adsr::new(sr);

    let stream = device.build_output_stream(
        &config,
        move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
            // Wrap in assert_no_alloc so any accidental allocation aborts in
            // debug/test builds.  Compiles to a no-op in release.
            assert_no_alloc(|| {
                // Drain all pending note events (pure index math, no alloc/lock).
                while let Some(ev) = consumer.try_pop() {
                    apply_event(&mut voices, ev, sr);
                }
                render_block(data, &mut voices, channels, AMPLITUDE, &adsr);
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

    /// Mono / last-note priority: a new note-on takes the voice (entering attack);
    /// a note-off releases it only if it matches the currently sounding note.
    #[test]
    fn last_note_priority_overwrites_and_off_matches() {
        let mut voices = [Voice::SILENT; VOICE_COUNT];
        let sr = 44_100.0;

        apply_event(&mut voices, NoteEvent::NoteOn { note: 60 }, sr);
        apply_event(&mut voices, NoteEvent::NoteOn { note: 64 }, sr);
        assert!(voices[0].is_sounding());
        assert_eq!(voices[0].note, 64, "latest note-on should take the voice");

        // Off for the overridden note must NOT release the current note.
        apply_event(&mut voices, NoteEvent::NoteOff { note: 60 }, sr);
        assert_ne!(
            voices[0].stage,
            EnvStage::Release,
            "note-off for an overridden key released the live note"
        );

        // Off for the sounding note moves it into release (still sounding briefly).
        apply_event(&mut voices, NoteEvent::NoteOff { note: 64 }, sr);
        assert_eq!(voices[0].stage, EnvStage::Release);
    }

    /// A sounding voice renders in-bounds, phase-advancing audio shaped by its
    /// envelope; an idle voice renders silence.
    #[test]
    fn render_block_is_bounded_and_advances_sounding_voice() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let adsr = Adsr::new(44_100.0);

        let mut voices = [Voice::SILENT; VOICE_COUNT];
        apply_event(&mut voices, NoteEvent::NoteOn { note: 69 }, 44_100.0);
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        render_block(&mut buf, &mut voices, CHANNELS, AMPLITUDE, &adsr);

        assert!(voices[0].phase > 0.0, "phase did not advance");
        for &s in buf.iter() {
            assert!(
                (-AMPLITUDE..=AMPLITUDE).contains(&s),
                "sample {s} out of bounds [-{AMPLITUDE}, {AMPLITUDE}]"
            );
        }
        assert!(
            buf.iter().any(|&s| s.abs() > 1e-6),
            "sounding voice produced silence"
        );

        // Idle voice -> pure silence.
        let mut silent = [Voice::SILENT; VOICE_COUNT];
        let mut buf2 = [0.0f32; FRAMES * CHANNELS];
        render_block(&mut buf2, &mut silent, CHANNELS, AMPLITUDE, &adsr);
        assert!(buf2.iter().all(|&s| s == 0.0), "idle voice produced sound");
    }

    /// The load-bearing invariant: the *real* callback hot path — drain events
    /// via `try_pop` + `apply_event`, then `render_block` — allocates nothing.
    /// A non-matching note-off is included so every `apply_event` arm runs under
    /// the guard.
    #[test]
    fn callback_hot_path_does_not_allocate() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let sr = 44_100.0_f32;

        // Build + fill the queue OUTSIDE the no-alloc region (alloc allowed here).
        let rb = HeapRb::<NoteEvent>::new(EVENT_QUEUE_CAPACITY);
        let (mut producer, mut consumer) = rb.split();
        producer.try_push(NoteEvent::NoteOn { note: 69 }).unwrap();
        producer.try_push(NoteEvent::NoteOff { note: 70 }).unwrap(); // non-matching
        producer.try_push(NoteEvent::NoteOn { note: 72 }).unwrap();

        let mut voices = [Voice::SILENT; VOICE_COUNT];
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        let adsr = Adsr::new(sr);

        assert_no_alloc(|| {
            while let Some(ev) = consumer.try_pop() {
                apply_event(&mut voices, ev, sr);
            }
            render_block(&mut buf, &mut voices, CHANNELS, AMPLITUDE, &adsr);
        });

        assert!(
            voices[0].is_sounding(),
            "voice should be sounding the last note"
        );
        assert_eq!(voices[0].note, 72);
        assert!(voices[0].phase > 0.0, "phase did not advance");
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
        let mut voices = [Voice::SILENT; VOICE_COUNT];

        // Onset: first rendered output sample from silence must be ~0.
        apply_event(&mut voices, NoteEvent::NoteOn { note: 69 }, 44_100.0);
        let mut first = [0.0f32; 1];
        render_block(&mut first, &mut voices, CH, AMPLITUDE, &adsr);
        assert!(
            first[0].abs() < 1e-3,
            "onset click: first output {} not below -60 dBFS",
            first[0]
        );

        // Drive through attack/decay into sustain, then release and render to Idle.
        let mut warm = [0.0f32; 8192];
        render_block(&mut warm, &mut voices, CH, AMPLITUDE, &adsr);
        apply_event(&mut voices, NoteEvent::NoteOff { note: 69 }, 44_100.0);

        let mut last_nonzero = 0.0f32;
        let mut reached_idle = false;
        for _ in 0..64 {
            let mut block = [0.0f32; 1024];
            render_block(&mut block, &mut voices, CH, AMPLITUDE, &adsr);
            for &s in block.iter() {
                if s != 0.0 {
                    last_nonzero = s;
                }
            }
            if !voices[0].is_sounding() {
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

    /// Retrigger continuity (the load-bearing comment in `apply_event`): a note-on
    /// on an already-sounding voice must NOT reset phase or env — otherwise every
    /// retrigger clicks.  This pins the invariant against a future "reset the
    /// oscillator on note-on" edit.
    #[test]
    fn retrigger_keeps_phase_and_env_continuous() {
        const CH: usize = 1;
        let adsr = Adsr::new(44_100.0);
        let mut voices = [Voice::SILENT; VOICE_COUNT];

        apply_event(&mut voices, NoteEvent::NoteOn { note: 60 }, 44_100.0);
        let mut buf = [0.0f32; 512];
        render_block(&mut buf, &mut voices, CH, AMPLITUDE, &adsr);
        let phase_before = voices[0].phase;
        let env_before = voices[0].env;
        assert!(
            phase_before > 0.0 && env_before > 0.0,
            "voice should be sounding before the retrigger"
        );

        apply_event(&mut voices, NoteEvent::NoteOn { note: 64 }, 44_100.0);
        assert_eq!(
            voices[0].phase, phase_before,
            "retrigger reset phase (would click)"
        );
        assert_eq!(
            voices[0].env, env_before,
            "retrigger reset env (would click)"
        );
        assert_eq!(
            voices[0].stage,
            EnvStage::Attack,
            "retrigger should re-enter attack"
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
}
