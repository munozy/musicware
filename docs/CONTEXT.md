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

- **Audio graph** — The in-memory structure describing how tracks/clips route and sum into the output. The Python back-end owns it.
- **Signal path** — The end-to-end route a sample travels: microphone capture → audio graph → file/output. The developer must be able to explain it end-to-end (an MVP acceptance criterion).
- **Buffer** — A block of audio samples processed per callback (e.g. 512 samples ≈ 11 ms at 44.1 kHz). **Buffer size** trades latency against stability.
- **Underrun** — The audio callback fails to deliver a buffer in time, causing an audible glitch/dropout. The primary symptom of the Python GIL/GC feasibility risk.
- **Latency** — Time from input/action to audible output. MVP target: round-trip under 20 ms; engine buffer stable at 512 samples.
- **Sample rate** — Samples per second of audio (e.g. 44.1 kHz). Fixed for the MVP.

## Architecture terms

- **Sidecar** — The Python back-end process running alongside the React UI inside the packaged macOS app; owns audio capture, the audio graph, and export.
- **IPC round-trip** — A UI event travelling React → Python sidecar → response. Its latency under audio load is the subject of Spike 2 (target: median < 50 ms).
