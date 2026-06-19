// Real-time-safety guard: in debug/test builds, any allocation inside
// `assert_no_alloc(|| { ... })` will abort immediately rather than silently
// causing an underrun.  This compiles to the system allocator in release
// (zero release cost).
#[cfg(debug_assertions)]
#[global_allocator]
static A: assert_no_alloc::AllocDisabler = assert_no_alloc::AllocDisabler;

pub mod audio;

use audio::AudioEngine;
use tauri::State;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start the audio engine and begin sine tone playback.
#[tauri::command]
fn start_tone(engine: State<AudioEngine>) -> Result<(), String> {
    engine.start()
}

/// Stop the audio engine and silence playback.
#[tauri::command]
fn stop_tone(engine: State<AudioEngine>) -> Result<(), String> {
    engine.stop()
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AudioEngine::new())
        .invoke_handler(tauri::generate_handler![start_tone, stop_tone])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
