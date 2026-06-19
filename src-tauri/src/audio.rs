//! Real-time audio engine for musicware (STORY-01).
//!
//! Architecture
//! ============
//! `cpal::Stream` is `!Send`/`!Sync`, so it cannot live in Tauri managed state.
//! Instead, a dedicated **audio thread** owns the `Stream` for its entire lifetime.
//! Tauri-managed state (`AudioEngine`) holds only `Send + Sync` handles:
//!   - `running`   – `AtomicBool`  signals the thread to stop
//!   - `freq_hz`   – `AtomicU32`   stores the tone frequency as integer Hz
//!   - `underruns` – `AtomicUsize` incremented by the cpal error callback
//!   - `thread`    – `Mutex<Option<JoinHandle>>` joined on stop
//!
//! Real-time safety
//! ================
//! The cpal data callback must never allocate and never acquire a lock.
//! `fill_sine` is a pure stack-only function; all shared state is read via
//! atomics (Ordering::Relaxed).  In debug/test builds, the callback body is
//! wrapped in `assert_no_alloc::assert_no_alloc(|| { ... })` — any accidental
//! heap allocation panics immediately rather than silently causing an underrun.
//!
//! Error callback note (CoreAudio)
//! ================================
//! On CoreAudio, cpal surfaces stream problems (including buffer underruns)
//! through the error callback rather than through a dedicated underrun event.
//! Therefore "0 error-callback invocations over the full run" is the practical
//! proxy for "0 underruns."  The `underruns` counter measures exactly this.

use assert_no_alloc::assert_no_alloc;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Default sine tone frequency (A4).
const DEFAULT_FREQ_HZ: u32 = 440;

/// Amplitude chosen low enough to avoid a harsh tone during feasibility testing.
const AMPLITUDE: f32 = 0.15;

/// Preferred buffer size in frames (512 ≈ 11 ms at 44.1 kHz).
const PREFERRED_BUFFER_FRAMES: u32 = 512;

// ---------------------------------------------------------------------------
// Public state (Tauri managed)
// ---------------------------------------------------------------------------

/// Shared handles to the audio thread.  Only `Send + Sync` types here —
/// the `cpal::Stream` is owned exclusively by the audio thread.
pub struct AudioEngine {
    running: Arc<AtomicBool>,
    freq_hz: Arc<AtomicU32>,
    pub underruns: Arc<AtomicUsize>,
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
            freq_hz: Arc::new(AtomicU32::new(DEFAULT_FREQ_HZ)),
            underruns: Arc::new(AtomicUsize::new(0)),
            thread: Mutex::new(None),
        }
    }

    /// Start the audio thread and begin sine playback.
    /// If already running, this is a no-op.
    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.thread.lock().map_err(|e| e.to_string())?;
        if self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        self.underruns.store(0, Ordering::SeqCst);

        let running = Arc::clone(&self.running);
        let freq_hz = Arc::clone(&self.freq_hz);
        let underruns = Arc::clone(&self.underruns);

        let handle = thread::spawn(move || {
            audio_thread(running, freq_hz, underruns);
        });

        *guard = Some(handle);
        Ok(())
    }

    /// Signal the audio thread to stop and wait for it to exit.
    pub fn stop(&self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);

        let mut guard = self.thread.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = guard.take() {
            handle
                .join()
                .map_err(|_| "audio thread panicked".to_string())?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Audio thread entry point
// ---------------------------------------------------------------------------

/// Owns the `cpal::Stream` for its entire lifetime.
/// Blocks until `running` is set to `false`, then drops the stream and exits.
fn audio_thread(running: Arc<AtomicBool>, freq_hz: Arc<AtomicU32>, underruns: Arc<AtomicUsize>) {
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

    let mut phase: f32 = 0.0;

    let stream = device.build_output_stream(
        &config,
        move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
            // Wrap in assert_no_alloc so any accidental allocation aborts in
            // debug/test builds.  Compiles to a no-op in release.
            assert_no_alloc(|| {
                let freq = freq_hz.load(Ordering::Relaxed) as f32;
                let sr = sample_rate.0 as f32;
                fill_sine(data, &mut phase, freq, sr, channels, AMPLITUDE);
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
// Pure sine fill — extracted for unit testing
// ---------------------------------------------------------------------------

/// Fill `out` with interleaved sine samples.
///
/// - `out`         – interleaved output slice (frames * channels samples)
/// - `phase`       – phase accumulator in radians, advanced in-place
/// - `freq_hz`     – tone frequency
/// - `sample_rate` – device sample rate
/// - `channels`    – number of interleaved channels
/// - `amp`         – peak amplitude (0.0–1.0)
///
/// Stack-only: no allocations, no locks — safe to call from a real-time callback.
pub fn fill_sine(
    out: &mut [f32],
    phase: &mut f32,
    freq_hz: f32,
    sample_rate: f32,
    channels: usize,
    amp: f32,
) {
    let phase_delta = 2.0 * std::f32::consts::PI * freq_hz / sample_rate;
    let frame_count = out.len() / channels.max(1);

    for frame in 0..frame_count {
        let sample = amp * phase.sin();
        for ch in 0..channels {
            out[frame * channels + ch] = sample;
        }
        *phase += phase_delta;
        // Wrap phase to avoid f32 precision loss over very long runs.
        if *phase >= 2.0 * std::f32::consts::PI {
            *phase -= 2.0 * std::f32::consts::PI;
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use assert_no_alloc::assert_no_alloc;

    /// Verify `fill_sine` produces in-bounds, non-zero output and advances the
    /// phase — all without heap allocation (enforced by `assert_no_alloc`).
    #[test]
    fn fill_sine_is_bounded_nonzero_and_advances_phase() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        let mut phase: f32 = 0.0;

        assert_no_alloc(|| {
            fill_sine(&mut buf, &mut phase, 440.0, 44100.0, CHANNELS, AMPLITUDE);
        });

        // Phase must have advanced.
        assert!(phase > 0.0, "phase did not advance");

        // Every sample must be within [-amp, amp].
        for &s in buf.iter() {
            assert!(
                s >= -AMPLITUDE && s <= AMPLITUDE,
                "sample {s} out of bounds [-{AMPLITUDE}, {AMPLITUDE}]"
            );
        }

        // At least one sample must be non-zero (tone is not silence).
        let any_nonzero = buf.iter().any(|&s| s.abs() > 1e-6);
        assert!(any_nonzero, "all samples are zero — tone is silent");
    }

    /// Exercise the operations the real-time callback actually performs —
    /// atomic load + cast + `fill_sine` — and prove the whole hot path is
    /// allocation-free, not just `fill_sine` in isolation.
    #[test]
    fn callback_hot_path_does_not_allocate() {
        const FRAMES: usize = 512;
        const CHANNELS: usize = 2;
        let mut buf = [0.0f32; FRAMES * CHANNELS];
        let mut phase: f32 = 0.0;
        let freq_hz = AtomicU32::new(DEFAULT_FREQ_HZ);
        let sample_rate: f32 = 44_100.0;

        assert_no_alloc(|| {
            let freq = freq_hz.load(Ordering::Relaxed) as f32;
            fill_sine(&mut buf, &mut phase, freq, sample_rate, CHANNELS, AMPLITUDE);
        });

        assert!(phase > 0.0, "phase did not advance");
    }
}
