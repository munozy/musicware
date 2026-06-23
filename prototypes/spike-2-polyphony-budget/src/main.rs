//! THROWAWAY spike — PRD-002 assumption KA1 / DEBT-012.
//!
//! Question: does polyphonic mix + per-sample ADSR envelope fit the 512-frame
//! real-time budget? If 16 voices of the *most expensive* realistic oscillator
//! (an 8-partial additive tone — the "organ-ish" preset) plus a per-sample
//! envelope render a 512-frame block well inside ~11.6 ms, then the cheaper
//! waveforms (sine/saw/square/triangle) trivially do too, and STORY-K3's
//! headline gate is feasible.
//!
//! This is NOT production code. It models the render cost only — no cpal, no
//! real device. Two things are measured:
//!   1. NO-ALLOC: run the DEBUG build — `assert_no_alloc` + the AllocDisabler
//!      global allocator make any heap allocation on the render path panic.
//!   2. TIMING: run the RELEASE build (`cargo run --release`) — that is the
//!      authoritative per-block time; debug timing is indicative only.

use assert_no_alloc::assert_no_alloc;
use std::time::Instant;

// In debug/test builds, route allocations through the disabler so
// `assert_no_alloc` actually catches them — exactly as the production engine does.
#[cfg(debug_assertions)]
#[global_allocator]
static A: assert_no_alloc::AllocDisabler = assert_no_alloc::AllocDisabler;

const SAMPLE_RATE: f32 = 44_100.0;
const BLOCK_FRAMES: usize = 512;
const CHANNELS: usize = 2;
const MAX_VOICES: usize = 16; // generous polyphony target
const PARTIALS: usize = 8; // additive harmonics — worst-case oscillator
const TWO_PI: f32 = 2.0 * std::f32::consts::PI;

// ADSR segment lengths in samples (≈ 5 / 40 / 300 / 60 ms at 44.1 kHz).
const ATTACK: u32 = 220;
const DECAY: u32 = 1_764;
const SUSTAIN_LEN: u32 = 13_230;
const RELEASE: u32 = 2_646;
const SUSTAIN_LEVEL: f32 = 0.7;

#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Copy)]
struct Voice {
    stage: Stage,
    phase: f32,
    phase_delta: f32,
    env: f32,
    samples_in_stage: u32,
}

impl Voice {
    fn new(freq_hz: f32) -> Self {
        Voice {
            stage: Stage::Attack,
            phase: 0.0,
            phase_delta: TWO_PI * freq_hz / SAMPLE_RATE,
            env: 0.0,
            samples_in_stage: 0,
        }
    }

    /// One sample: 8-partial additive oscillator * per-sample ADSR envelope.
    /// Pure stack work — this is the cost we are probing. Voices re-trigger at
    /// the end of release so the load stays continuous (all ADSR branches run).
    #[inline(always)]
    fn next_sample(&mut self) -> f32 {
        // Additive oscillator: sum of PARTIALS harmonics with 1/k amplitude.
        let mut osc = 0.0f32;
        let mut k = 1usize;
        while k <= PARTIALS {
            osc += (1.0 / k as f32) * (self.phase * k as f32).sin();
            k += 1;
        }
        self.phase += self.phase_delta;
        if self.phase >= TWO_PI {
            self.phase -= TWO_PI;
        }

        // Linear ADSR state machine (cheap; exercised every sample).
        self.samples_in_stage += 1;
        match self.stage {
            Stage::Attack => {
                self.env += 1.0 / ATTACK as f32;
                if self.samples_in_stage >= ATTACK {
                    self.env = 1.0;
                    self.stage = Stage::Decay;
                    self.samples_in_stage = 0;
                }
            }
            Stage::Decay => {
                self.env -= (1.0 - SUSTAIN_LEVEL) / DECAY as f32;
                if self.samples_in_stage >= DECAY {
                    self.env = SUSTAIN_LEVEL;
                    self.stage = Stage::Sustain;
                    self.samples_in_stage = 0;
                }
            }
            Stage::Sustain => {
                if self.samples_in_stage >= SUSTAIN_LEN {
                    self.stage = Stage::Release;
                    self.samples_in_stage = 0;
                }
            }
            Stage::Release => {
                self.env -= SUSTAIN_LEVEL / RELEASE as f32;
                if self.samples_in_stage >= RELEASE {
                    self.env = 0.0;
                    self.stage = Stage::Attack; // re-trigger: keep load continuous
                    self.samples_in_stage = 0;
                }
            }
        }

        osc * self.env
    }
}

/// Render one interleaved stereo block by summing all voices. Stack-only.
#[inline(always)]
fn render_block(voices: &mut [Voice; MAX_VOICES], out: &mut [f32; BLOCK_FRAMES * CHANNELS]) {
    let gain = 1.0 / MAX_VOICES as f32; // headroom: scale by voice count
    for frame in 0..BLOCK_FRAMES {
        let mut sum = 0.0f32;
        for v in voices.iter_mut() {
            sum += v.next_sample();
        }
        let s = (sum * gain).clamp(-1.0, 1.0);
        out[frame * CHANNELS] = s;
        out[frame * CHANNELS + 1] = s;
    }
}

fn main() {
    // 16 voices spread across a few octaves (cost is freq-independent; this just
    // models a dense held chord). note -> Hz: 440 * 2^((n-69)/12).
    let mut voices: [Voice; MAX_VOICES] = std::array::from_fn(|i| {
        let note = 36 + (i as i32) * 3; // C2 upward in minor thirds
        let freq = 440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0);
        Voice::new(freq)
    });

    let mut out = [0.0f32; BLOCK_FRAMES * CHANNELS];

    let budget_ms = (BLOCK_FRAMES as f32 / SAMPLE_RATE) * 1000.0;
    let blocks_60s = (60.0 * SAMPLE_RATE / BLOCK_FRAMES as f32).round() as usize;

    // Warm up (let the CPU settle; discard timing).
    for _ in 0..200 {
        assert_no_alloc(|| render_block(&mut voices, &mut out));
    }

    // Measure: render 60 s worth of blocks, timing each individually.
    let mut max_block_ms = 0.0f32;
    let mut sink = 0.0f32; // keep the optimiser from eliding the work
    let total_start = Instant::now();
    for _ in 0..blocks_60s {
        let t = Instant::now();
        assert_no_alloc(|| render_block(&mut voices, &mut out));
        let elapsed_ms = t.elapsed().as_secs_f32() * 1000.0;
        if elapsed_ms > max_block_ms {
            max_block_ms = elapsed_ms;
        }
        sink += out[0] + out[BLOCK_FRAMES]; // touch output
    }
    let total = total_start.elapsed();
    let mean_block_ms = (total.as_secs_f32() * 1000.0) / blocks_60s as f32;

    let profile = if cfg!(debug_assertions) {
        "DEBUG (no-alloc enforced; timing indicative only)"
    } else {
        "RELEASE (authoritative timing; no-alloc NOT enforced here)"
    };
    let mean_load = mean_block_ms / budget_ms * 100.0;
    let max_load = max_block_ms / budget_ms * 100.0;
    // A single missed block = an audible glitch, so the hard requirement is
    // max < budget. "Comfortable" = worst-case under half the budget.
    let pass = max_block_ms < budget_ms;
    let comfortable = max_block_ms < budget_ms * 0.5;

    println!("=== PRD-002 KA1 spike — polyphony fits the real-time budget? ===");
    println!("build profile     : {profile}");
    println!("voices            : {MAX_VOICES} (additive, {PARTIALS} partials each) + per-sample ADSR");
    println!("block             : {BLOCK_FRAMES} frames x {CHANNELS} ch @ {SAMPLE_RATE:.0} Hz");
    println!("budget / block    : {budget_ms:.3} ms  (512 / 44100)");
    println!("blocks rendered   : {blocks_60s}  (~60 s of audio)");
    println!("mean / block      : {mean_block_ms:.4} ms  ({mean_load:.1}% of budget)");
    println!("MAX  / block      : {max_block_ms:.4} ms  ({max_load:.1}% of budget)  <-- worst case");
    println!("sink (ignore)     : {sink:.3}");
    println!();
    println!(
        "VERDICT           : {}",
        if !pass {
            "FAIL — a block exceeded the deadline (would glitch)"
        } else if comfortable {
            "PASS (comfortable) — worst-case block under half the budget"
        } else {
            "PASS (tight) — fits, but worst-case uses >50% of budget; watch headroom"
        }
    );
    if cfg!(debug_assertions) {
        println!("NOTE              : run `cargo run --release` for the real timing verdict.");
    }
}
