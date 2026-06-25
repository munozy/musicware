# CONTEXT — ubiquitous language

> The single canonical glossary for this project. Moonozy and the `domain-model` skill write terms here.
> One vocabulary, code ↔ domain (Evans). Keep definitions short; supersede rather than contradict.

Seeded 2026-06-19 from BC-001 (Discovery). These are working definitions for a learning DAW; the
`domain-model` skill will refine them and add aggregates/contexts after the feasibility spikes.

## Core domain terms

- **Track** — A single recordable/playable lane of audio (e.g. one microphone input or one imported file). Has per-track controls (gain, pan). The MVP targets 4 mono tracks.
- **Clip** — A bounded piece of audio placed on a track at a position on the timeline. A track holds zero or more clips.
- **Region** — A selected span of the timeline (start/end), independent of clips. Used to define what plays, what exports, and what loops.
- **Loop** — A region marked to repeat continuously during playback. The MVP targets looping a 4-bar region.
- **Transport** — The playback control surface and its state: play, stop, record, and the current playhead position.
- **Mixdown** — The result of summing all tracks (with their gain/pan) into a single stereo output, exported as a WAV file.
- **Gain** — Per-track output level (volume). **Pan** — Per-track left/right stereo placement.

## Audio engine & runtime terms

- **Audio graph** — The in-memory structure describing how tracks/clips route and sum into the output. The Rust audio engine owns it (ADR-0001).
- **Signal path** — The end-to-end route a sample travels: microphone capture → audio graph → file/output. The developer must be able to explain it end-to-end (an MVP acceptance criterion).
- **Buffer** — A block of audio samples processed per callback (e.g. 512 samples ≈ 11 ms at 44.1 kHz). **Buffer size** trades latency against stability.
- **Underrun** — The audio callback fails to deliver a buffer in time, causing an audible glitch/dropout. The primary symptom of the Python GIL/GC feasibility risk.
- **Latency** — Time from input/action to audible output. MVP target: round-trip under 20 ms; engine buffer stable at 512 samples.
- **Sample rate** — Samples per second of audio (e.g. 44.1 kHz). Fixed for the MVP.
- **Master volume** — The single user output level in `[0, 1]` (default 0.6) applied to the whole rendered mix as `level × VOLUME_GAIN_MAX` (ADR-0003). `level == 1.0` reads as single-note full scale. An output/monitor setting — orthogonal to notes/presets and **not** recorded.
- **Limiter** — The post-render output stage that hard-clamps every sample to `[-1, 1]` after the master-volume scale (`apply_master_volume`, ADR-0003). Guarantees a valid sample to the DAC by construction; in practice it is the audible ceiling (a dense chord can reach it).

## Synthesis terms

> Added 2026-06-23 from [PRD-002](product/prds/PRD-002-playable-keyboard-synth.md) (playable keyboard synth). A *parallel, additive* track on top of the STORY-01 engine; no hardware MIDI.

- **Oscillator** — The thing that generates a periodic waveform from a phase accumulator. **Waveform** — its shape: sine, saw, square, triangle, or an **additive** sum of harmonics.
- **Voice** — One sounding note: an oscillator + its envelope + the note it's playing. The synth holds a fixed pool of voices.
- **Polyphony** — How many voices can sound at once (a held chord). MVP target: ≥ 8. **Voice stealing** — when more notes are requested than voices exist, the oldest voice is reclaimed.
- **Envelope (ADSR)** — The per-voice amplitude shape over time: Attack, Decay, Sustain, Release. Ramps a note in/out so it doesn't click on note-on/note-off.
- **Note event** — A **note-on** (start a pitch) or **note-off** (release it), issued by the UI and delivered to the real-time thread via the ring buffer. Drives voice allocation.
- **Note number / pitch** — A note is identified by an integer note number; its frequency is `f = 440·2^((n−69)/12)` (A4 = 69 = 440 Hz). This is pitch math, **not** MIDI I/O.
- **Preset** — A named timbre = a waveform + an envelope, selectable live (e.g. Sine / Organ / Piano / Bells / Drums). The waveform applies to all voices; each voice captures its envelope preset at note-on (STORY-K4).
- **Drum kit** — The "Drums" preset: an *unpitched* percussion timbre where the note's **pitch class** (`note % 12`) selects a drum (kick, snare, hat, tom…) rather than a pitch. Synthesised from pitch-swept sines + bright (high-passed) noise (ADR-0005), not a tonal waveform.
- **One-shot** — A voice that plays a fixed sound to completion and frees itself (ignoring note-off), rather than sustaining until key-up. Drums are one-shots: a hit rings out its baked decay regardless of how briefly the key is held.
- **Theremin** — A preset: a warm near-sine voiced with **vibrato** + a soft swell envelope (slow attack/release, no percussive onset) for the instrument's eerie wavering tone (ADR-0006).
- **Vibrato** — A gentle periodic **pitch** wobble from a low-frequency oscillator (LFO). The Theremin's signature: ~5.5 Hz, ±~0.5 semitone, applied per-sample as a phase modulation. (Distinct from tremolo, which modulates *amplitude*.)
- **LFO (low-frequency oscillator)** — A sub-audio oscillator used to *modulate* another parameter rather than be heard directly (here, the vibrato pitch wobble). Per-voice, precomputed rate.
- **Glissando** — Playing by holding the pointer down and sliding across keys: each key the cursor enters sounds and releases as the cursor leaves it (driven by pointer enter/leave with the primary button held).
- **Recording** — A saved take: a named, timestamped stream of the UI's note/preset events, captured at the synth dispatch choke point and persisted to `localStorage` (ADR-0002). Symbolic events, **not** audio.
- **Take** — One captured performance from record-start to stop — the unit a Recording holds. Held notes are auto-closed at stop so a take is self-contained; an empty take (no note-ons) is discarded.
- **Replay** — Playing back a Recording by re-dispatching its events to the engine on a schedule (ADR-0002). Uses the same dispatch path as live play, so it sounds the same and lights the same keys.

## Architecture terms

> Per [ADR-0001](architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md): React+TS UI in **Tauri (v2)**, **Rust** audio engine. No Python.

- **Tauri command** — The control-rate IPC call from the React UI to the Rust core (with **Tauri events** for Rust→UI notifications: playhead, meter levels at ~30–60 Hz). Replaces the former cross-process React↔Python IPC.
- **Real-time thread** — The dedicated thread running the audio callback (via `cpal`). It must never block, lock, or allocate — doing so causes an underrun.
- **Ring buffer** — The lock-free single-producer/single-consumer queue carrying data between the UI-facing Rust layer and the real-time thread, so the audio callback never waits.
- **IPC round-trip** — A control-rate message travelling React → Rust (via a Tauri command) → response. **Audio samples never cross this boundary** (ADR-0001).
- **Sidecar** — An out-of-process helper bundled with the app. **Not used in the core architecture** (audio runs in-process in Rust); reserved only as a possible future home for non-real-time extensions (e.g. Python scripting/ML).
