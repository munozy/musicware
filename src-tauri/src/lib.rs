// Real-time-safety guard: in debug/test builds, any allocation inside
// `assert_no_alloc(|| { ... })` will abort immediately rather than silently
// causing an underrun.  This compiles to the system allocator in release
// (zero release cost).
#[cfg(debug_assertions)]
#[global_allocator]
static A: assert_no_alloc::AllocDisabler = assert_no_alloc::AllocDisabler;

pub mod audio;

use audio::{AudioEngine, NoteEvent};
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

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AudioEngine::new())
        .invoke_handler(tauri::generate_handler![
            start_engine,
            stop_engine,
            note_on,
            note_off,
            set_preset,
            set_volume
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
