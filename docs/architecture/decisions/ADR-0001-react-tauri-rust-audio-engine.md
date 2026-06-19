# ADR-0001 — React UI in Tauri with a Rust audio engine

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-19
- **Deciders:** developer (solo)

## Context

musicware is a personal **learning DAW** (BC-001): record and layer up to ~4 tracks, define and loop a region,
apply per-track gain/pan, and export a stereo mixdown on macOS. Its positioning is learning value, not a
commercial product — the comparison class is "GarageBand is free and already works," so the project justifies
itself on what the developer learns and on having a usable, self-built artifact.

The founding idea (and the PROPOSED stack in `state.json`) was **React + Python**, with the audio engine in
Python via a library such as `sounddevice`/`miniaudio`. BC-001's feasibility analysis identified **feasibility
as the dominant risk**, with two concrete threats:

1. Python in/near the real-time audio path: the **GIL** and **garbage-collector** pauses can cause buffer
   **underruns** at the target buffer size.
2. **React↔Python IPC round-trip latency** across a separate process, which adds latency and complexity, with
   packaging (Electron+sidecar, Tauri+sidecar, PyWebView, native) still undecided.

BC-001 therefore recommended **EXPLORE** — time-boxed spikes to quantify these risks before any sustained build.
Having evaluated the options against the learning goal and the real-time-audio constraint, the developer has now
made the stack decision. This ADR records that decision before sustained build begins; it does not re-open it.

## Decision

We will build musicware as a **macOS desktop app** with a **React + TypeScript** UI hosted in **Tauri (v2)**
and a **Rust real-time audio engine**. **We will not use Python.**

- **UI.** We will render the React + TypeScript UI in Tauri's webview (WKWebView on macOS). We will draw the
  timeline, waveforms, meters, and playhead on **Canvas/WebGL**; React handles the surrounding panels
  (transport, mixer, track headers).
- **Audio engine.** We will implement the engine in **Rust**, using a proven real-time audio library —
  **`cpal`** for device I/O, with **`fundsp`**/**`dasp`** as candidate DSP crates and **`hound`** as a candidate
  WAV read/write crate. The real-time audio callback runs on its **own thread**, with **no garbage collector and
  no GIL** in the audio path.
- **IPC / boundary.** Control-rate commands flow UI → Rust via **Tauri commands**; state and notifications
  (playhead position, meter levels at ~30–60 Hz) flow Rust → UI via **Tauri events**. **Audio samples never
  cross to the UI.** Between the UI-facing Rust layer and the real-time audio thread we will use a **lock-free
  channel / ring buffer** (e.g. `ringbuf`/`crossbeam`) so the audio callback never blocks and never allocates.
- **Packaging.** Tauri bundles a single macOS `.app`, with a small bundle and low memory footprint relative to
  Electron.
- **No Python.** Python may return **later** as an **out-of-process sidecar** for non-real-time extensions only;
  that is explicitly out of scope for this decision.

## Consequences

- **Positive:**
  - Eliminates the dominant BC-001 feasibility risk — **no GIL and no GC in the audio path**.
  - Strong real-time audio story: a dedicated, lock-free, allocation-free callback thread via `cpal`.
  - **Tiny bundle and low memory** versus Electron; single macOS `.app`.
  - **End-to-end type safety** (TypeScript in the UI, Rust in the engine).
  - **In-process-fast** control IPC via Tauri commands, versus a separate Python process and cross-process IPC.
- **Negative (cost accepted):**
  - **Rust has a steep learning curve** — ownership/borrow-checker plus the discipline of real-time-safe code
    (no allocation, no locking in the callback).
  - The high-level **DSP ecosystem is smaller and less mature than C++ (JUCE)** for advanced features.
  - The developer must also learn **Tauri's command/event/sidecar model**.
  - **Webview rendering varies slightly per OS** (low concern — macOS only).
- **Risks (with mitigation / fitness functions):**
  - **Real-time-safety bugs** (allocation or locking in the callback) cause underruns. *Mitigation:* a strict
    **no-alloc / no-lock rule** in the audio thread, with the **glitch test as a fitness function** (glitch-free
    playback at a 512-sample buffer for 60 seconds on Apple Silicon, per BC-001's acceptance test).
  - **Rust learning curve could stall momentum.** *Mitigation:* start with a **thin vertical slice** — glitch-free
    playback of a tone first, then record → playback of one track — before adding any further scope.
  - **Spike supersession.** BC-001's **Spike 1 (Python latency)** is now **SUPERSEDED** by this decision. The
    residual validation is a small **Rust/`cpal` glitch-free-playback spike**, and **Spike 2** becomes
    "React↔Rust via Tauri commands" — a much lower risk, largely answered by Tauri's design.

## Alternatives considered

1. **React + Python audio engine** (Electron, or Tauri + Python sidecar) — the original proposal. *Rejected:*
   Python in/near the real-time audio path is the project's biggest risk (GIL/GC underruns), and the
   cross-process IPC adds latency and complexity.
2. **React + Web Audio API / AudioWorklet** (no Python, no Rust) — the lowest-friction way to ship a DAW; avoids
   both the GIL/GC and the cross-process IPC risks. *Rejected:* the audio work would live in TypeScript, which
   does not serve the developer's interest in building a real systems / real-time audio engine.
3. **Electron + Rust** — workable, but Electron's heavy Chromium bundle and Node backend add weight with no
   benefit over Tauri for this use case. *Rejected* on bundle size and memory.
4. **Native C++ / JUCE** — the industry-standard, most capable path. *Rejected:* overkill for a learning project
   and a much steeper, less web-friendly route than Tauri + React.
5. **Do nothing / use GarageBand** — fails the learning objective (BC-001). *Rejected.*

## Links
PRD: PRD-001 (pending) · Issues: — · Related/superseded ADRs: — · Tech-spec: TS-001 (pending) · Glossary terms touched: track, audio graph, signal path, buffer, underrun, latency, sidecar, IPC round-trip — and recommend ADDING: "real-time thread", "ring buffer", "Tauri command" (and revise "audio graph"/"sidecar", which currently assume a Python back-end).
