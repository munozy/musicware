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

/// Begin sounding a note at the given note number (A4 = 69 = 440 Hz).
#[tauri::command]
fn note_on(engine: State<AudioEngine>, note: u8) -> Result<(), String> {
    engine.send_event(NoteEvent::NoteOn { note })
}

/// Release a note.  Only silences the voice if it is still playing that note.
#[tauri::command]
fn note_off(engine: State<AudioEngine>, note: u8) -> Result<(), String> {
    engine.send_event(NoteEvent::NoteOff { note })
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

/// Render the active song's symbolic stream to mono f32 PCM (little-endian bytes) for export.
/// The frontend mixes in the voice clips and encodes (WAV/MP3); this reproduces the synth
/// exactly (audio::render_offline), off the real-time thread. JS receives an ArrayBuffer.
#[tauri::command]
fn render_song(events: Vec<RenderEvent>, total_ms: f64, sample_rate: u32) -> tauri::ipc::Response {
    let sr = sample_rate.max(8_000) as f32;
    let total_samples = ((total_ms.max(0.0) / 1000.0) * sr as f64).ceil() as usize;
    let seq: Vec<(usize, audio::SeqEvent)> = events
        .iter()
        .filter_map(|e| {
            let at = ((e.t.max(0.0) / 1000.0) * sr as f64).round() as usize;
            match e.kind.as_str() {
                "on" => e.note.map(|n| (at, audio::SeqEvent::On { note: n })),
                "off" => e.note.map(|n| (at, audio::SeqEvent::Off { note: n })),
                "preset" => e.index.map(|i| (at, audio::SeqEvent::Preset { index: i })),
                _ => None,
            }
        })
        .collect();
    let pcm = audio::render_offline(&seq, total_samples, sr);
    let mut bytes = Vec::with_capacity(pcm.len() * 4);
    for s in pcm {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    tauri::ipc::Response::new(bytes)
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
