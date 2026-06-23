//! Glitch-free tone playback — 60-second feasibility gate (STORY-01, carried
//! into STORY-K1).
//!
//! Since STORY-K1 the engine starts SILENT, so this gate sends a note-on (A4)
//! before measuring — otherwise it would validate a silent stream and pass
//! vacuously.  (STORY-K3 will extend this to hold the maximum voice count
//! sounding, per PRD-002.)
//!
//! This test is marked `#[ignore]` so it does NOT run during normal `cargo test`
//! (it emits an audible tone and takes up to 60 seconds).
//!
//! How to run on macOS/Apple Silicon:
//!
//!   GLITCH_TEST_SECS=60 cargo test --manifest-path src-tauri/Cargo.toml \
//!       --test glitch_free_60s -- --ignored
//!
//! A short smoke run (useful for CI pre-flight):
//!
//!   GLITCH_TEST_SECS=2 cargo test --manifest-path src-tauri/Cargo.toml \
//!       --test glitch_free_60s -- --ignored
//!
//! Pass criteria: the underrun counter (error-callback invocations) reported by
//! the engine is 0 for the entire duration.  On CoreAudio, cpal surfaces stream
//! problems — including buffer underruns — through the error callback, so
//! "0 error-callback invocations" is the practical proxy for "0 underruns."

use musicware_lib::audio::{AudioEngine, NoteEvent};
use std::sync::atomic::Ordering;
use std::time::Duration;

#[test]
#[ignore]
fn glitch_free_60s() {
    let secs: u64 = std::env::var("GLITCH_TEST_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);

    let engine = AudioEngine::new();

    match engine.start() {
        Ok(()) => {}
        Err(e) => {
            // No output device available (headless CI, etc.) — skip gracefully.
            eprintln!("[glitch_gate] skipping: could not start audio engine — {e}");
            return;
        }
    }

    // Sound a note so the gate exercises the real render path, not silence.
    engine
        .send_event(NoteEvent::NoteOn { note: 69 })
        .expect("failed to send note-on");

    println!("[glitch_gate] sounding note 69 (A4 = 440 Hz) for {secs}s — listen for glitches …");
    std::thread::sleep(Duration::from_secs(secs));

    let underruns = engine.underruns.load(Ordering::SeqCst);

    engine.stop().expect("failed to stop audio engine");

    println!("[glitch_gate] done. underruns (error-callback invocations): {underruns}");
    assert_eq!(
        underruns, 0,
        "FAILED feasibility gate: {underruns} underrun(s) detected over {secs}s"
    );
}
