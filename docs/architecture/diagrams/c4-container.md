# C4 — Container view (musicware)

> Level 2 (Container) of the [C4 model](https://c4model.com). Reflects [ADR-0001](../decisions/ADR-0001-react-tauri-rust-audio-engine.md).
> One level of abstraction per diagram. Glossary: [docs/CONTEXT.md](../../CONTEXT.md).

```mermaid
C4Container
    title Container diagram for musicware — a personal learning DAW (ADR-0001)

    Person(user, "Musician", "Records, layers, loops and exports music")

    System_Boundary(app, "musicware.app  (single macOS .app, packaged by Tauri v2)") {
        Container(ui, "UI", "React + TypeScript, in WKWebView", "Transport, mixer, track headers (React); timeline / waveforms / meters / playhead (Canvas/WebGL)")
        Container(core, "App core", "Rust (Tauri commands & events)", "Project & track state; receives control commands; emits playhead + meter events ~30–60 Hz")
        Container(engine, "Audio engine", "Rust on a real-time thread (cpal)", "Capture, mix the audio graph, loop a region, export a mixdown. No alloc / no lock in the callback")
    }

    System_Ext(coreaudio, "CoreAudio", "macOS audio I/O (devices, mic)")
    System_Ext(fs, "File system", "WAV mixdown + project files")

    Rel(user, ui, "Interacts with")
    Rel(ui, core, "Control-rate commands", "Tauri command")
    Rel(core, ui, "Notifications: playhead, meters", "Tauri event ~30–60 Hz")
    Rel(core, engine, "Commands + audio data", "Lock-free ring buffer")
    Rel(engine, coreaudio, "Audio callback (in/out)", "real-time")
    Rel(engine, fs, "Read/write audio", "WAV")
```

## Legend / key decisions (per ADR-0001)
- **Audio samples never cross to the UI.** The UI only sends control commands and receives low-rate state (playhead, meter levels). This is what keeps the React↔Rust boundary cheap.
- The **real-time thread** (audio callback) must never block, lock, or allocate — violating that causes an **underrun**. The **ring buffer** is the only channel between the app core and that thread.
- No Python. A future out-of-process **sidecar** (for non-real-time extensions only) would appear here as another container; it is out of scope today.

## Fitness function
Glitch-free playback at a 512-sample buffer for 60 s with **0 underruns** on Apple Silicon (carried as DEBT-008; to be promoted to a runnable acceptance spec during the vertical slice).
