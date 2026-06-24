//! Glitch-free polyphony gate (STORY-01 → K1 → K2 → STORY-K3).
//!
//! Holds the MAXIMUM voice count (`VOICE_COUNT` distinct notes) sounding and
//! asserts 0 underruns — the PRD-002 headline fitness function.
//!
//! NON-VACUITY (the key property). `AudioEngine::start()` returns `Ok` *before*
//! the audio thread checks for a device, so it cannot tell us whether audio is
//! actually flowing. Instead we assert `engine.sounding_voices` reaches
//! `VOICE_COUNT`: that counter is written from inside the cpal callback, which
//! only runs when a device is open and the event queue drained. So the gate
//! FAILS on a partial pool, dropped events, OR a stream build/format/play
//! failure — every vacuity mode except a genuinely deviceless machine, which it
//! distinguishes via `engine.no_device` (set only when there is no output device).
//!
//! Two entry points share `run_gate`. `glitch_free_60s` is the `#[ignore]`d 60 s
//! acceptance gate (audible; run on demand via
//! `GLITCH_TEST_SECS=60 cargo test --test glitch_free_60s -- --ignored`).
//! `polyphony_smoke` is a short (2 s) variant that runs on every `cargo test`, so
//! the real cpal polyphony path is exercised in the loop, not just on demand.
//!
//! Headless CI has no audio device. Set `GLITCH_ALLOW_NO_DEVICE=1` to downgrade a
//! missing device to a printed skip (the CI workflow does this); without it, a
//! missing device FAILS — so the gate stays non-vacuous on a developer machine.

use musicware_lib::audio::{AudioEngine, NoteEvent, VOICE_COUNT};
use std::sync::atomic::Ordering;
use std::time::Duration;

/// Start the engine, hold `VOICE_COUNT` distinct notes for `secs`, and assert the
/// full pool sounds the whole time with 0 underruns and 0 dropped events.
fn run_gate(secs: u64) {
    // Opt-in skip-on-no-device for headless CI. Keyed on the exact value "1" (not
    // mere presence) so `GLITCH_ALLOW_NO_DEVICE=0` does not surprise-enable it.
    let allow_no_device = std::env::var("GLITCH_ALLOW_NO_DEVICE").as_deref() == Ok("1");

    let engine = AudioEngine::new();
    engine
        .start()
        .expect("FAIL: could not start the audio engine");

    // Time the heaviest render path: the additive Organ waveform (8 harmonics per
    // voice), not the default single-sine. The waveform is global (read per block),
    // so this makes the gate exercise worst-case per-sample cost under full
    // polyphony — DEBT-015's intent. Sleep so the audio thread reads the new preset
    // before the notes are drained.
    engine.set_preset(1); // 1 = Organ (additive)
    std::thread::sleep(Duration::from_millis(50));

    // Sound VOICE_COUNT distinct notes (no note-offs → they stay held).
    for note in 60u8..(60 + VOICE_COUNT as u8) {
        engine
            .send_event(NoteEvent::NoteOn { note })
            .expect("failed to send note-on");
    }

    // Poll (up to ~2 s) for the callbacks to raise the sounding count to the full
    // pool — robust to device cold-start latency rather than a fixed sleep.
    let mut sounding = 0;
    for _ in 0..100 {
        sounding = engine.sounding_voices.load(Ordering::Relaxed);
        if sounding == VOICE_COUNT {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    // Skip ONLY for a genuinely deviceless machine (when opted in). A stream
    // build / format / play failure on a device that IS present leaves
    // `no_device` false, so we still hard-fail — the gate can't pass on a broken
    // engine just because it produced no audio.
    let no_device = engine.no_device.load(Ordering::SeqCst);
    if no_device && allow_no_device {
        eprintln!("[gate] skipping: no audio output device (GLITCH_ALLOW_NO_DEVICE=1 set)");
        let _ = engine.stop();
        return;
    }
    assert_eq!(
        sounding, VOICE_COUNT,
        "FAIL non-vacuous gate: {sounding}/{VOICE_COUNT} voices sounding \
         (no_device={no_device}; engine failed to run / load not exercised / dropped events)"
    );

    println!("[gate] holding {VOICE_COUNT} notes for {secs}s — listen for glitches …");
    std::thread::sleep(Duration::from_secs(secs));

    // Still fully sounding (no note-offs were sent).
    let still = engine.sounding_voices.load(Ordering::Relaxed);
    let underruns = engine.underruns.load(Ordering::SeqCst);
    let dropped = engine.dropped_events.load(Ordering::SeqCst);
    engine.stop().expect("failed to stop audio engine");

    assert_eq!(
        still, VOICE_COUNT,
        "FAIL: pool dropped to {still}/{VOICE_COUNT} voices during the hold"
    );
    println!("[gate] done. underruns={underruns}, dropped_events={dropped}");
    assert_eq!(
        underruns, 0,
        "FAILED feasibility gate: {underruns} underrun(s) over {secs}s under {VOICE_COUNT}-voice load"
    );
    assert_eq!(dropped, 0, "FAILED: {dropped} note event(s) dropped");
}

/// Headline acceptance gate — 60 s of full polyphony, run on demand.
#[test]
#[ignore]
fn glitch_free_60s() {
    let secs: u64 = std::env::var("GLITCH_TEST_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    run_gate(secs);
}

/// Non-`#[ignore]`d polyphony smoke — runs every `cargo test`, exercising the
/// real cpal 16-voice render path so the gate path can't rot between full runs.
#[test]
fn polyphony_smoke() {
    let secs: u64 = std::env::var("GLITCH_TEST_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2);
    run_gate(secs);
}
