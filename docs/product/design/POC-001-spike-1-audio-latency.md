# POC-001 — Spike 1: Python audio latency baseline

> ⚠️ **SUPERSEDED by [ADR-0001](../../architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md)** (2026-06-19). The project chose a **Rust** audio engine over Python, so the Python-in-audio-path risk this spike was built to measure no longer applies. The spike code was removed; this brief is kept as a record of why Python was not pursued.

> Owner: developer (solo). Norman/Nielsen/Torres: prototype to **learn**, throwaway by design.
> Lived in `prototypes/spike-1-audio-latency/` — never production source.

## Question / risk being tested
**Feasibility** (the dominant risk in [BC-001](../business-cases/BC-001-musicware-learning-daw.md)): can a Python back-end sustain glitch-free, low-latency audio on macOS — i.e. can it return audio buffers fast enough to avoid underruns, at a latency low enough to be usable?

## What was built
A throwaway CLI probe (`latency_probe.py`) with four modes:
- `devices` — list audio devices.
- `glitch` — play a continuous sine for 60 s at a chosen blocksize; count CoreAudio output underflows (the GIL/GC symptom).
- `report` — print CoreAudio's reported input/output latency (no loopback needed).
- `roundtrip` — emit an impulse on output, detect it on input via a loopback path, compute measured round-trip latency = (detected input sample − emitted output sample) ÷ sample rate.

Location: `prototypes/spike-1-audio-latency/` (+ `requirements.txt`, `README.md`).

## How it was tested
To be run by the developer on the target Mac (needs audio hardware + mic permission; `roundtrip` needs a loopback path — BlackHole or a cable). Pass criteria from BC-001:
- `glitch`: **0 underflows** over 60 s at blocksize **512** (~11 ms @ 44.1 kHz); then probe how low the blocksize can go.
- `roundtrip`: record measured round-trip latency; MVP target **< 20 ms**.

## What we learned
_Pending — fill `prototypes/spike-1-audio-latency/results.md` after running (Mac model/chip, macOS version, smallest glitch-free blocksize, reported + measured latency, anything surprising)._

## Decision
- [ ] **Graduate** (→ needs PRD + ADR; hand off to architect/engineer)
- [ ] **Iterate** (another PoC round)
- [x] **Drop** — superseded by ADR-0001. Rather than measure Python's audio limits, the project adopted a Rust engine (no GIL/GC in the audio path), which the C/Rust fallback in this spike's own gate anticipated.

## Status (mirror in state.prototypes)
`superseded` — linkedADR: ADR-0001

## Links
PRD: pending · ADR: ADR-0001 (accepted — Rust engine chosen) · Discovery: BC-001 (Spike 1)
