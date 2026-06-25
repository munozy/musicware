# ADR-0004 — Live visualizer is a note-broadcast-driven representation

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-25
- **Deciders:** Architecture + developer (munozy)

## Context
The UI overhaul adds a live visualizer (oscilloscope / bars / radial) that should react to what's
playing. ADR-0001 set a hard boundary: the Rust audio engine runs on a dedicated real-time thread and
**audio samples never cross to the UI** — only control-rate events do (note on/off, preset, volume).
A visualizer that reacted to the *true* output signal would need audio (or an FFT of it) to cross that
boundary, coupling the UI render loop to the real-time thread.

## Decision
We will drive the visualizer entirely from the **synth note broadcast** the UI already emits
(`synth.subscribeNotes` → `useActiveNotes`), and **synthesise** the on-screen waveform in the frontend
from the frequencies of the currently-sounding notes. No audio buffer, PCM, or spectrum data crosses
the IPC boundary. The visualizer is a *representation* of what is playing, not a measurement of the
output signal.

## Consequences
- **Positive:** ADR-0001's boundary is preserved unchanged; the audio thread gains no UI coupling and
  no new IPC; the visualizer is cheap (a few sines on a canvas) and reuses the same broadcast that
  drives the keyboard highlight and chord display (one source of truth, `useActiveNotes`). It reacts
  identically to live play and recording replay for free.
- **Negative / accepted:** it is not a true oscilloscope/spectrum — it shows the *pitches* being held,
  not the actual timbre, amplitude envelope, or the master-volume/limiter result. The shape is
  illustrative, not analytic.
- **Risks:** a user may read it as a real scope. Mitigation: it's framed as a visual aid; if a true
  analyser is ever wanted, it is a new ADR (it would require routing audio to the webview or streaming
  analysis data, re-opening the ADR-0001 boundary).

## Alternatives considered
- **Stream PCM / FFT frames Rust→UI** (Tauri events): would give a true scope but violates ADR-0001's
  "audio never crosses to the UI" and couples the UI to the RT thread's cadence — rejected.
- **Web Audio `AnalyserNode`:** the app produces sound in Rust/cpal, not via the webview's Web Audio
  graph, so there is no in-browser signal to analyse — not applicable.
- **No visualizer:** rejected — the user explicitly asked for a "fancy" live visual.

## Links
PRD: PRD-002 · Related ADRs: ADR-0001 (audio/UI boundary) · Tech-spec: — · Open debt: DEBT-021 (refresh
the C4 container diagram for the Visualizer component) · Glossary terms touched: —
