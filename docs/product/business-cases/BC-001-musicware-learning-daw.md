# BC-001 — musicware: a personal learning DAW

> Owner: developer (solo). Date: 2026-06-19.
> Cagan discipline: decision-grade, problem-first, outcome-anchored. Sized for a solo learning project — no invented revenue numbers.

---

## Problem & opportunity size

**Learning problem.** The developer wants hands-on depth in two technical areas that cannot be learned by reading alone: (1) audio DSP and real-time signal processing at a meaningful resolution (sample-accurate recording, mixing, looping, export), and (2) React+Python desktop architecture at a non-trivial scale (IPC, event loops, packaging, latency budgets). Existing tutorials and toy examples do not reach DAW-level complexity.

**Personal-tool problem.** A working artifact that the developer (and optionally a small circle of friends) actually uses to make music would validate that the learning translated into real production value — not just a proof-of-concept that runs once.

**The prize.** Concrete, demonstrable skills: audio DSP fundamentals, low-latency pipeline design, React-as-desktop-UI, Python audio engine (via a library such as `sounddevice`/`miniaudio`/`pyo`), and a shipped packaging solution for macOS. The artifact itself — a usable personal DAW — is a secondary but motivating reward.

**Scope boundary (explicit).** This is NOT a commercial product. TAM, revenue, and market positioning are out of scope. The comparison class is "GarageBand is free and already works" — the project must justify itself on learning value alone.

---

## Target outcome & metric

**Primary outcome:** The developer can, on macOS, record N audio tracks simultaneously, layer them, define and loop a region, apply basic per-track gain/pan, and export a stereo mixdown — with audible round-trip latency under 20 ms on a MacBook — and has done so using code they wrote and understand.

**Measurable proxy (MVP acceptance test):**
- Record 4 mono tracks, loop a 4-bar region, play back without audible glitches at a 512-sample buffer on Apple Silicon.
- Export a WAV mixdown that opens correctly in a second application (e.g. QuickTime).
- Developer can explain the signal path from microphone capture to file write without consulting external documentation.

**Learning checkpoint:** After the feasibility spike phase (see Decision section), the developer can answer: "What is the round-trip latency of a React UI action reaching the Python audio engine and producing audible output, and what is the bottleneck?"

---

## Options considered

### 1. Do nothing — use GarageBand and learn by reading
GarageBand is free, ships on macOS, and covers all the features in scope. Learning resources for audio DSP and Python audio exist independently.

- **Learning value:** Low. Reading and watching does not build the integration, debugging, and architectural judgement that comes from building. GarageBand is a black box.
- **Effort:** Near zero.
- **Outcome gap:** The developer does not acquire React+Python desktop architecture experience, does not understand audio pipelines at an implementation level, and has no original artifact.
- **Verdict:** Fails the learning objective entirely. Valid fallback only if feasibility spikes reveal the stack is unworkable and morale collapses.

### 2. Thin React UI over an existing audio engine library (recommended path)
Build a React (TypeScript) front-end as the UI shell; delegate all audio work to a mature Python audio library (`sounddevice`, `pyo`, or `miniaudio` via Python bindings). The developer writes the audio graph logic and UI/engine IPC but does not implement DSP primitives from scratch.

- **Learning value:** High. Covers IPC design, audio graph architecture, real-time scheduling, packaging, and UI — without the combinatorial risk of re-implementing FFT/convolution.
- **Effort:** Moderate. Estimated 3–6 months of evenings to reach a usable MVP (recording, mixing, looping, export). Long tail of "pro DAW features" is effectively unbounded — must be scoped ruthlessly.
- **Feasibility risk:** Significant. Python's GIL and garbage collector are hostile to hard real-time audio. IPC between React and a Python process adds latency. These risks are EXPLORABLE — cheap spikes can quantify them before committing.
- **Verdict:** Best balance of learning depth and achievability. Recommended, conditional on feasibility spikes.

### 3. Build the audio engine from scratch (max depth)
Implement DSP primitives (mixing engine, sample-accurate scheduler, effects chain) in Python or in a C extension called from Python, in addition to the UI and IPC layer.

- **Learning value:** Very high for DSP fundamentals. Too high to be practical as a first project.
- **Effort:** High to very high. A production-quality audio engine is a multi-year project. Scope creep risk is severe.
- **Feasibility risk:** Very high. The developer is learning DSP simultaneously with building it; correctness and latency bugs will compound.
- **Verdict:** Worthwhile as a second-phase goal (e.g. write a custom effect plugin) once the baseline pipeline is proven. Not the right starting point.

### 4. Fork or extend an open-source DAW (e.g. Ardour, LMMS)
Contribute to or extend an existing open-source DAW codebase written in C++.

- **Learning value:** High for C++ audio systems, moderate for the stated React+Python goal (none, actually — different stack).
- **Effort:** High onboarding cost; large foreign codebase.
- **Stack alignment:** Zero. The stated goal is React+Python desktop architecture.
- **Verdict:** Eliminated. Does not address the stated learning objectives.

---

## Recommended option

**Option 2: thin React UI over a Python audio engine library, starting with EXPLORE mode (feasibility spikes before any sustained build).**

Reasoning against the 4 risks:

| Risk | Assessment |
|---|---|
| **Value** | Low risk. The value proposition is personal learning + a usable artifact. Even a partially working DAW that the developer built delivers the learning outcome. No market dependency. |
| **Usability** | Medium risk. A DAW UI is inherently complex (timeline, mixer, transport, clip editor). The developer is both designer and user, which removes the "wrong user" failure mode but introduces "scope creep toward polish." Mitigation: lock UI scope to the MVP acceptance test; defer everything else. |
| **Feasibility** | HIGH RISK — the dominant risk for this project. Two specific threats: (a) Python's GIL and GC pauses can cause audio buffer underruns; (b) IPC round-trip latency between a React renderer and a Python audio process may exceed the acceptable budget for a responsive UI. Neither is fatal, but both must be measured before committing months of work. Packaging (Electron+sidecar, Tauri+sidecar, PyWebView, or native macOS with embedded Python) is undecided and affects latency, distribution, and developer ergonomics. This is an assumption that must become an ADR. |
| **Viability** | Not applicable in the commercial sense. For a personal project, "viability" means: does the developer sustain motivation through the hard parts? Mitigation: keep MVP scope tiny, celebrate the feasibility spike as a milestone, avoid the trap of specifying "pro DAW features" before basics work. |

**The single biggest unvalidated assumption: a Python audio backend can sustain glitch-free playback at an acceptable latency on macOS, even when driven by IPC commands from a React front-end running in a separate process.**

Until this is measured, no further scoping or build work is justified.

---

## Cost / effort vs expected value

| Phase | Effort estimate (solo evenings) | Expected output |
|---|---|---|
| Feasibility spikes (3 spikes, see below) | 1–2 weeks | Go/no-go signal on stack viability; latency numbers; packaging shortlist |
| MVP core (recording, playback, looping, export) | 8–16 weeks | Passing MVP acceptance test |
| Polish + additional features | Unbounded | Do not plan; add only after MVP acceptance test passes |

The long tail of "pro DAW features" (MIDI, VST, automation, spectral editing, etc.) is effectively infinite. The project must treat the MVP acceptance test as a hard scope boundary, not a starting point. Every feature added before the test passes is scope creep.

No monetary cost assumed beyond developer time and a macOS machine (already owned).

---

## Risks & assumptions

| # | Risk / assumption | Likelihood | Impact | Marked for early discovery? |
|---|---|---|---|---|
| R1 | Python GIL / GC causes buffer underruns at target buffer size on macOS | Medium | High (invalidates stack) | YES — Spike 1 |
| R2 | React↔Python IPC adds unacceptable latency for UI responsiveness | Medium | High (invalidates architecture) | YES — Spike 2 |
| R3 | Packaging approach (Electron, Tauri, PyWebView, native) creates blocking issues (bundle size, IPC constraints, macOS permissions) | Medium | Medium (delays, not fatal) | YES — Spike 3 |
| R4 | Scope creep toward "pro DAW" features before MVP works | High | High (kills motivation, kills project) | Monitor continuously |
| R5 | Developer wants breadth (many features) over depth (understanding the pipeline) | Low (stated preference is depth) | Medium | Revisit after Spike 1 |
| A1 | `sounddevice` or equivalent Python library can provide a stable low-latency callback on macOS | Assumed true; must be tested | — | Spike 1 |
| A2 | React (TypeScript) is an acceptable UI toolkit for a DAW-class timeline and mixer at MVP scope | Assumed true; no evidence yet | — | Defer to MVP phase; not a blocker |

---

## Decision & next step

**Decision: EXPLORE.**

Do not begin sustained feature build. Run three time-boxed feasibility spikes (max 1–2 weeks total). Gate the build decision on the spikes' outcomes.

### Feasibility spikes

**Spike 1 — Python audio latency baseline (2–3 evenings)**
- Goal: Measure round-trip latency from Python audio callback to audible output using `sounddevice` (or `miniaudio` bindings) on macOS. Target: glitch-free playback at 256- and 512-sample buffers. Confirm the GIL is not causing underruns.
- **Measurement method (so the result is reproducible):** drive a software loopback — open one full-duplex stream, emit a known impulse/click on output and record it on input, then compute round-trip latency as the sample-index delta between emitted and detected impulse divided by the sample rate. Log the device's reported latency alongside the measured value, and count callback underruns via the stream's `status` flags over a 60-second run. (If no loopback device is available, use a physical cable from output to input.)
- Pass criterion: stable playback at 512 samples (~11 ms at 44.1 kHz) for 60 seconds without underruns on target hardware; measured round-trip latency recorded.
- Output: a single Python script + latency measurements saved to a file.

**Spike 2 — React↔Python IPC latency under audio load (2–3 evenings)**
- Goal: Measure the round-trip time of a UI event (e.g. "play" button click in a minimal React app) arriving at a Python process and triggering a response, while the Python process is running an audio callback loop. Test at least two IPC mechanisms (e.g. WebSocket vs. stdio/JSON vs. named pipe).
- Pass criterion: median IPC round-trip under 50 ms; no audio glitches introduced by IPC activity.
- Output: minimal React + Python harness + latency measurements.

**Spike 3 — Packaging smoke test (1–2 evenings)**
- Goal: Get a React front-end and a Python sidecar running in the same packaged macOS app bundle using at least one candidate approach (e.g. Electron with a Python sidecar managed by `electron-builder`, or PyWebView). Confirm macOS audio permissions work from within the bundle.
- Pass criterion: the bundle launches, the Python sidecar starts, microphone permission is granted, and a test tone plays.
- Output: a minimal throwaway repo + notes on what worked and what did not. This feeds directly into the packaging ADR.

**Spike 0 — Throwaway UI sketch (30–60 minutes, do first)**
- Goal: Before chasing latency numbers, confirm the MVP UI is even drawable at the locked scope (Norman/Nielsen — *prototype to learn*). Sketch the minimal surface on paper or in Figma: transport bar (play/stop/record + playhead), a timeline with 4 track lanes, a clip on a lane, a loop region, and per-track gain/pan. This makes the "Usability: medium" risk concrete instead of deferred and pressure-tests the MVP scope boundary.
- Pass criterion: a single sketch exists that the developer believes is buildable in React at MVP scope; no interaction or styling required.
- Output: one image/photo of the sketch checked into the repo (or `docs/product/design/`). Throwaway — not a design spec.

**Owner:** developer (solo).

**After spikes:** write (1) a PRD scoping the MVP to exactly the acceptance test defined above, and (2) an ADR on packaging/audio-engine architecture, informed by spike outcomes. Both are prerequisites before writing any production code.

---

## Links

PRD: pending (to be written after feasibility spikes pass)
Discovery: Spike 1 · Spike 2 · Spike 3 (see Decision section above)
Related ADRs: ADR-001 (packaging / IPC) — pending
