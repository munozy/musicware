// Real-time-safety guard: in debug/test builds, any allocation inside
// `assert_no_alloc(|| { ... })` will abort immediately rather than silently
// causing an underrun.  This compiles to the system allocator in release
// (zero release cost).
#[cfg(debug_assertions)]
#[global_allocator]
static A: assert_no_alloc::AllocDisabler = assert_no_alloc::AllocDisabler;

pub mod audio;

use audio::{AudioEngine, NoteEvent};
use serde::Deserialize;
use tauri::State;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start the audio engine (silent until notes are played).  Optional — the
/// engine also auto-starts on the first `note_on`.
#[tauri::command]
fn start_engine(engine: State<AudioEngine>) -> Result<(), String> {
    engine.start()
}

/// Stop the audio engine and tear down the audio thread (all notes go silent).
#[tauri::command]
fn stop_engine(engine: State<AudioEngine>) -> Result<(), String> {
    engine.stop()
}

/// Highest accepted note number (the MIDI range). IPC input is clamped HERE — the engine's
/// per-sample phase maths assumes audible-range deltas, and the UI can only produce 0..=127,
/// so an out-of-range value can only arrive from a direct IPC call (DEBT-034 hardening).
/// On and off clamp identically, so a clamped pair still matches.
const MAX_NOTE: u8 = 127;

/// Begin sounding a note at the given note number (A4 = 69 = 440 Hz).
#[tauri::command]
fn note_on(engine: State<AudioEngine>, note: u8) -> Result<(), String> {
    engine.send_event(NoteEvent::NoteOn {
        note: note.min(MAX_NOTE),
    })
}

/// Release a note.  Only silences the voice if it is still playing that note.
#[tauri::command]
fn note_off(engine: State<AudioEngine>, note: u8) -> Result<(), String> {
    engine.send_event(NoteEvent::NoteOff {
        note: note.min(MAX_NOTE),
    })
}

/// Select the timbre preset by index (0 = Sine, 1 = Organ, 2 = Piano).  Clamped,
/// so any value is safe; takes effect within ~one audio block.
#[tauri::command]
fn set_preset(engine: State<AudioEngine>, index: u8) {
    engine.set_preset(index);
}

/// Set the master volume level in [0, 1].  Clamped, so any value is safe; takes
/// effect within ~one audio block.
#[tauri::command]
fn set_volume(engine: State<AudioEngine>, level: f32) {
    engine.set_volume(level);
}

/// One flattened symbolic event from the frontend scheduler (note on/off + preset),
/// timestamped in ms — the input to the offline song render (export).
#[derive(Deserialize)]
struct RenderEvent {
    t: f64,
    kind: String,
    note: Option<u8>,
    index: Option<u8>,
}

/// Longest offline render accepted (ms). The render allocates the full PCM buffer up front,
/// so an unbounded caller-supplied length is a memory-exhaustion DoS from any webview script
/// (DEBT-034). The frontend caps exports at 30 min; the extra minute covers its release tail.
const MAX_RENDER_MS: f64 = 31.0 * 60.0 * 1000.0;

/// Map the frontend events to the offline sequencer's form (times → sample indices, notes
/// clamped to the MIDI range). Pure — unit-tested.
fn build_seq(events: &[RenderEvent], sr: f32) -> Vec<(usize, audio::SeqEvent)> {
    events
        .iter()
        .filter_map(|e| {
            let at = ((e.t.max(0.0) / 1000.0) * sr as f64).round() as usize;
            match e.kind.as_str() {
                "on" => e.note.map(|n| {
                    (
                        at,
                        audio::SeqEvent::On {
                            note: n.min(MAX_NOTE),
                        },
                    )
                }),
                "off" => e.note.map(|n| {
                    (
                        at,
                        audio::SeqEvent::Off {
                            note: n.min(MAX_NOTE),
                        },
                    )
                }),
                "preset" => e.index.map(|i| (at, audio::SeqEvent::Preset { index: i })),
                _ => None,
            }
        })
        .collect()
}

/// Validated render core: clamps the sample rate, rejects non-finite / over-long lengths
/// BEFORE allocating, and returns the PCM as little-endian bytes. Pure — unit-tested.
fn render_song_pcm(
    events: &[RenderEvent],
    total_ms: f64,
    sample_rate: u32,
) -> Result<Vec<u8>, String> {
    if !total_ms.is_finite() || total_ms > MAX_RENDER_MS {
        return Err(format!(
            "Render length out of range (max {} minutes).",
            (MAX_RENDER_MS / 60_000.0) as u32
        ));
    }
    let sr = sample_rate.clamp(8_000, 192_000) as f32;
    let total_samples = ((total_ms.max(0.0) / 1000.0) * sr as f64).ceil() as usize;
    let pcm = audio::render_offline(&build_seq(events, sr), total_samples, sr);
    let mut bytes = Vec::with_capacity(pcm.len() * 4);
    for s in pcm {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    Ok(bytes)
}

/// Render the active song's symbolic stream to mono f32 PCM (little-endian bytes) for export.
/// The frontend mixes in the voice clips and encodes (WAV/MP3); this reproduces the synth
/// exactly (audio::render_offline), off the real-time thread. JS receives an ArrayBuffer.
#[tauri::command]
fn render_song(
    events: Vec<RenderEvent>,
    total_ms: f64,
    sample_rate: u32,
) -> Result<tauri::ipc::Response, String> {
    render_song_pcm(&events, total_ms, sample_rate).map(tauri::ipc::Response::new)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AudioEngine::new())
        .invoke_handler(tauri::generate_handler![
            start_engine,
            stop_engine,
            note_on,
            note_off,
            set_preset,
            set_volume,
            render_song
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod ipc_hardening_tests {
    use super::*;

    fn ev(t: f64, kind: &str, note: Option<u8>, index: Option<u8>) -> RenderEvent {
        RenderEvent {
            t,
            kind: kind.into(),
            note,
            index,
        }
    }

    #[test]
    fn build_seq_clamps_notes_to_the_midi_range() {
        let seq = build_seq(
            &[
                ev(0.0, "on", Some(200), None),
                ev(10.0, "off", Some(200), None),
            ],
            44_100.0,
        );
        assert!(matches!(seq[0].1, audio::SeqEvent::On { note: 127 }));
        assert!(matches!(seq[1].1, audio::SeqEvent::Off { note: 127 })); // pair still matches
    }

    #[test]
    fn build_seq_drops_unknown_kinds_and_clamps_negative_times() {
        let seq = build_seq(
            &[
                ev(-50.0, "on", Some(60), None),
                ev(0.0, "bogus", Some(60), None),
            ],
            44_100.0,
        );
        assert_eq!(seq.len(), 1);
        assert_eq!(seq[0].0, 0); // t clamped to sample 0
    }

    #[test]
    fn render_rejects_over_long_and_non_finite_lengths_before_allocating() {
        assert!(render_song_pcm(&[], MAX_RENDER_MS + 1.0, 44_100).is_err());
        assert!(render_song_pcm(&[], f64::NAN, 44_100).is_err());
        assert!(render_song_pcm(&[], f64::INFINITY, 44_100).is_err());
    }

    #[test]
    fn render_clamps_the_sample_rate_and_sizes_the_buffer_from_it() {
        // sample_rate 1 clamps to 8 kHz → 10 ms = 80 samples = 320 bytes.
        let bytes = render_song_pcm(&[], 10.0, 1).expect("render");
        assert_eq!(bytes.len(), 80 * 4);
    }
}
