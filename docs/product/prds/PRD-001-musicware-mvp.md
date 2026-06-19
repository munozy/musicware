# PRD-001 — musicware MVP

> Owner: developer (solo). Date: 2026-06-19. Status: **Draft**.
> Scope: exactly the BC-001 acceptance test — nothing more, nothing less.
> tracker.mode = local — work items tracked as a checklist below and in `state.openDebt`.

---

## Problem & opportunity

The developer wants hands-on depth in two areas that cannot be learned by reading alone: (1) audio DSP and real-time signal processing at meaningful resolution — sample-accurate recording, mixing, looping, and export — and (2) React + Rust desktop architecture at non-trivial scale (IPC, event loops, latency budgets, packaging). Existing tutorials and toy examples do not reach DAW-level complexity.

A working artifact that the developer actually uses to make music validates that the learning translated into real production value. The comparison class is "GarageBand is free and already works" — the project justifies itself on learning depth and on the existence of a self-built, usable DAW.

The long tail of "pro DAW" features (MIDI, VST, automation, effects beyond gain/pan) is effectively infinite. The MVP acceptance test is a **hard ceiling**, not a starting point. Every feature added before the test passes is scope creep.

---

## Outcomes & success metrics

**One measurable outcome — the MVP acceptance test (BC-001):**

| Criterion | Pass definition |
|---|---|
| Multi-track recording | Record up to 4 mono tracks (mic input) and layer them |
| Loop | Define a region and loop it continuously during playback |
| Mix controls | Per-track gain and pan applied in the audio graph |
| Export | Stereo WAV mixdown that opens correctly in another app (e.g. QuickTime) |
| Glitch-free playback | 0 underruns at a 512-sample buffer for 60 s on Apple Silicon |
| Latency | Round-trip latency < 20 ms on the target machine |
| Signal-path explanation | Developer can explain the signal path from mic capture to file write without consulting external documentation |

All criteria must pass simultaneously. Any criterion failing means the MVP is not done.

---

## The 4 risks (and how each is addressed)

**Value — LOW.**
The value proposition is personal learning plus a usable self-built artifact. Even a partially working DAW that the developer built and understands delivers the primary learning outcome. There is no market dependency, no user acquisition, and no revenue to risk. The only "won't use it" failure mode is scope creep killing motivation — mitigated by the hard ceiling above.

**Usability — MEDIUM (the open design risk).**
A DAW UI is inherently complex: transport state, track arming, a timeline with clips and a loop region, playhead scrubbing, and per-track gain/pan together push the limits of what an MVP React surface can express without confusion. Relevant Nielsen heuristics for this surface: visibility of system status (transport play/record state, playhead position, meter levels must be always visible); match between system and the real world (track, clip, region, loop — glossary terms must map 1:1 to labelled controls); recognition over recall (arm/mute/solo, gain/pan must be discoverable without a manual). The reference wireframe in POC-002 (`prototypes/spike-0-ui-sketch/`) shows the MVP surface on a single screen and was **self-reviewed** against these heuristics; the developer's reaction validating that it is buildable in React at MVP scope (assumption A3) is **still pending (DEBT-006)** — so this confidence is not yet earned. The developer is both designer and sole user, which removes the "wrong user" failure mode but introduces "scope creep toward polish." Mitigation: lock UI scope to the single-screen wireframe; no styling sprint before the acceptance test passes.

**Feasibility — DE-RISKED BUT NOT PROVEN.**
ADR-0001 eliminated the dominant BC-001 feasibility risk (Python GIL/GC in the audio path) by choosing a Rust real-time audio engine via `cpal`. The audio callback runs on its own dedicated real-time thread with no garbage collector and no GIL. Control IPC is in-process via Tauri commands — a much smaller latency surface than a cross-process React↔Python channel. The residual, unproven risk: **glitch-free playback at a 512-sample buffer for 60 s has not yet been demonstrated in this codebase.** Story 1 (tone playback) is the feasibility-proving slice. It must pass before any further build work is justified. The fitness function — 0 underruns in 60 s — is the gate.

**Viability — MOTIVATION / SCOPE-CREEP.**
No commercial viability risk applies. For a personal project "viability" means: does the developer sustain motivation through the hard parts, and does the scope stay locked? Mitigations: (a) the acceptance test is the hard ceiling; (b) each story slice is independently demoable and celebratable; (c) explicitly name non-goals (see Scope section) so additions are conscious decisions, not drift.

---

## Users / personas

**The developer.** A solo engineer learning audio DSP and React + Rust desktop architecture. Also the primary (initially, sole) user of the resulting DAW. Wants both depth of understanding and a usable artifact. Not interested in building a commercial product. (BC-001.)

---

## Solution narrative

The developer sits at a MacBook running musicware. A single screen shows the transport bar at the top (play / stop / record buttons; current playhead position), four track lanes in the middle (each with an arm button, a gain knob, and a pan knob), and a timeline below each track header where recorded clips appear. A shaded region over the timeline marks the loop boundary — during playback this region repeats continuously. Hitting record arms the selected tracks; audio from the mic is captured in real-time and a new clip grows on the lane. Stopping recording leaves the clip visible and playable. With all four tracks recorded the developer nudges gain and pan on each, hears the mix through the monitor, then hits Export — a stereo WAV file lands on disk and opens in QuickTime. The developer can then trace every sample from the mic callback through the audio graph to the file write. That trace is the learning payoff.

---

## User stories (vertical slices — ordered by dependency)

Each slice is independently demoable. The first slice is the **feasibility gate**; it must pass before work on any later slice begins.

### Work-item checklist

- [ ] **STORY-01 — Glitch-free tone playback** *(FEASIBILITY-PROVING SLICE)*
  As a developer, I want the Rust audio engine to play a generated test tone through the system output for 60 s at a 512-sample buffer with 0 underruns, so that I know the real-time thread is safe before any recording work begins.

  **Acceptance criteria:**
  - Tauri app launches and the audio engine initialises via `cpal`.
  - A sine tone plays through the default output device.
  - After 60 s of continuous playback on Apple Silicon, the underrun counter reported by the engine is 0.
  - A single canonical integration test, `cargo test --test glitch_free_60s`, reproduces the measurement (one unambiguous invocation — this is the feasibility gate).
  - The real-time thread never allocates and never acquires a lock during playback — enforced **automatically**, not by code review: an `assert_no_alloc` guard (e.g. the `assert_no_alloc` crate) wraps the audio callback in test/debug builds, backed by a clippy lint on disallowed types. A violation fails the build/test, not a reviewer's memory.

- [ ] **STORY-02 — Record one mono track from the mic**
  As a developer, I want to arm one track and record audio from the microphone into a clip on the timeline, so that I have the record→capture leg of the signal path working end-to-end.

  **Acceptance criteria:**
  - Clicking Record on track 1 arms it and begins mic capture via `cpal`.
  - Captured samples are written into a clip data structure in the audio graph via the ring buffer.
  - Clicking Stop ends recording and the clip is visible on the timeline.
  - macOS mic permission is granted inside the `.app` bundle.
  - No underruns during a 30 s recording at a 512-sample buffer.

- [ ] **STORY-03 — Play back a recorded track**
  As a developer, I want to play back a recorded clip from the beginning, so that I can hear what was captured and confirm the audio graph routes correctly from clip to output.

  **Acceptance criteria:**
  - Clicking Play after recording plays the clip from bar 1 through the output device.
  - The playhead advances in the timeline, driven by Tauri events from the engine at 30–60 Hz.
  - Audio matches what was recorded (no pitch shift, no clipping, correct sample rate).
  - Playback is glitch-free at a 512-sample buffer for the clip's full duration.

- [ ] **STORY-04 — Record and layer up to 4 mono tracks**
  As a developer, I want to record a second, third, and fourth track while playing back existing tracks, so that I can layer a multi-track arrangement.

  **Acceptance criteria:**
  - Tracks 2, 3, and 4 can each be armed and recorded independently (overdub workflow: existing tracks play back while a new track records).
  - All 4 tracks play back simultaneously, summed in the audio graph, without underruns.
  - Per-track gain defaults (unity) are applied during the sum.
  - The transport correctly handles concurrent read and write access to track data via the ring buffer.

- [ ] **STORY-05 — Define and loop a region**
  As a developer, I want to mark a region on the timeline (start + end) and have playback loop that region continuously, so that I can practise loop-based arrangement.

  **Acceptance criteria:**
  - The developer can set a region start and end (e.g. bar 1 to bar 4) via a UI control or direct input.
  - The region is rendered as a shaded span on the timeline.
  - During playback, when the playhead reaches the region end it wraps to the region start without an audible gap or click.
  - Loop is visually indicated (e.g. a loop toggle active state in the transport).
  - Looping works with all 4 tracks playing simultaneously.

- [ ] **STORY-06 — Per-track gain and pan**
  As a developer, I want to adjust each track's gain and pan independently, so that I can balance the mix before export.

  **Acceptance criteria:**
  - Each track header exposes a gain control (linear or dB) and a pan control (L/R).
  - Changing gain or pan takes effect within one buffer of the control change (no perceptible lag).
  - Gain and pan are applied in the audio graph before summing (not applied post-mix).
  - Meter levels (per-track RMS or peak) are emitted by the engine as Tauri events and displayed in the UI at 30–60 Hz.
  - Gain at unity + pan at centre produces an output identical to the uncontrolled sum (regression test in `cargo test`).

- [ ] **STORY-07 — Export a stereo WAV mixdown**
  As a developer, I want to export the mix (with all gain and pan applied) as a stereo WAV file, so that the mixdown can be opened and heard in another application.

  **Acceptance criteria:**
  - An Export button triggers a Tauri command that instructs the engine to render the region to disk as a stereo WAV file (via `hound` or equivalent).
  - The exported file opens and plays correctly in QuickTime on macOS.
  - The exported audio matches what was heard during playback (gain and pan applied, no extra normalisation or processing).
  - Export runs off the real-time thread (non-real-time render path) and does not cause underruns in live playback.
  - The developer can trace every step of the signal path — mic capture → clip → audio graph → mix sum → WAV write — without consulting external documentation.

---

## Scope

### Now (MVP — hard ceiling)

- Glitch-free tone playback (Rust/cpal vertical slice)
- Record up to 4 mono tracks (mic input), layer them
- Define and loop a region
- Per-track gain and pan
- Export a stereo WAV mixdown (opens in QuickTime)
- macOS only, Apple Silicon target hardware

### Next (only after acceptance test passes)

- Developer-chosen: better waveform display, keyboard shortcuts, project save/load
- These are entirely unscoped here — they belong in a future PRD

### Out of scope (explicit non-goals)

- **MIDI** — no MIDI input, output, or clock
- **VST / plugin support** — no plugin host or AU/VST2/VST3 loading
- **Automation** — no parameter automation lanes
- **Effects beyond gain/pan** — no reverb, EQ, compression, or any insert/send effects
- **Multi-OS** — Windows and Linux are not targets for this PRD
- **Commercial distribution** — no App Store, no licensing, no telemetry
- **Import of external audio files** — only mic-recorded clips in-scope for MVP
- **Python** — eliminated by ADR-0001; not in scope for any part of this PRD

---

## Implementation decisions

**Stack (fixed by ADR-0001).** React + TypeScript UI in Tauri v2 (WKWebView); Rust real-time audio engine using `cpal` for device I/O. `fundsp`/`dasp` are candidate DSP crates; `hound` is the candidate WAV writer. No Python anywhere in the signal path.

**Container topology (C4-container).** Three containers inside the single `musicware.app`:
1. UI — React + TS; timeline/waveforms/meters/playhead on Canvas/WebGL; transport and mixer panels in React.
2. App core — Rust; owns project and track state; receives Tauri commands from the UI; emits Tauri events (playhead, meter levels) at 30–60 Hz.
3. Audio engine — Rust on the real-time thread (`cpal`); runs the audio graph, handles mic capture, loops the region, renders the mixdown.

**Real-time discipline (no exceptions in the audio callback).** The real-time thread must never allocate heap memory and must never acquire a lock. All data exchange between the app core and the audio engine uses a lock-free ring buffer (`ringbuf` or `crossbeam-queue`). Violating this rule causes an underrun.

**IPC boundary.** Control-rate commands travel UI → Rust via Tauri commands (in-process, low-latency). Notifications travel Rust → UI via Tauri events. Audio samples never cross to the UI.

**Timeline and waveform rendering.** Canvas/WebGL, not DOM, to avoid layout reflow on every playhead tick. The playhead position is received as a Tauri event and used to update the canvas directly.

**Export path.** Mixdown export is a non-real-time render: the engine writes all clips into a stereo buffer off the audio callback thread and hands it to `hound` (or equivalent) for WAV serialisation. This must not interrupt live playback.

---

## Testing decisions

**Feasibility gate (must pass before any story beyond STORY-01 is built).**
Glitch-free tone playback: 0 underruns at a 512-sample buffer for 60 s on Apple Silicon. This is the fitness function defined in ADR-0001 and C4-container. It is a runnable test (binary or `cargo test` integration test), not a manual check.

**Rust engine — `cargo test`.**
- Unit: audio graph summing, gain/pan application (STORY-06 regression: unity gain + centre pan = unmodified sum).
- Integration: record-then-playback of a synthetic buffer; loop wrap (no gap/click); WAV round-trip (write and read back via `hound`, sample-accurate).
- Fitness function: the 60 s underrun test (automated, reproducible).

**React UI — `vitest`.**
- Transport state machine: play/stop/record transitions.
- Tauri command dispatch: mock the Tauri IPC boundary; verify the correct command is sent on button click.
- Meter/playhead event ingestion: verify canvas update is triggered on event receipt.

**Manual checks (acceptance gate).**
- Export opens in QuickTime and plays without error (STORY-07).
- Developer can narrate the signal path end-to-end without notes (STORY-07 acceptance criterion).
- macOS mic permission dialog appears on first launch and persists (STORY-02).

**Non-goals for testing.**
- No end-to-end browser automation (no Playwright/Cypress) for MVP — too heavy for a solo project at this stage.
- No performance benchmarking beyond the fitness function.

---

## Discovery evidence & open questions

**Opportunity Solution Tree branch.** Root outcome: developer passes the MVP acceptance test and can explain the signal path. Opportunity: the feasibility-proving vertical slice (STORY-01) is the highest-priority discovery activity still open. Until it passes, the depth of all other stories is irrelevant.

**Evidence in hand.**
- BC-001: problem, options, 4-risk analysis, acceptance test.
- ADR-0001: stack decision (Rust/cpal), feasibility risk de-risked in theory.
- POC-002: low-fi UI wireframe covering the full MVP surface (usability risk partially addressed; reaction / annotation still pending per DEBT-006).
- C4-container: container topology consistent with ADR-0001.

**Unvalidated assumptions.**

| # | Assumption | What would prove/disprove it |
|---|---|---|
| A1 | `cpal` on macOS/Apple Silicon can sustain 0 underruns @512/60 s | STORY-01 fitness function |
| A2 | Lock-free ring buffer is sufficient for 4-track simultaneous record+playback without data races | STORY-04 integration test |
| A3 | The POC-002 single-screen layout is buildable in React at MVP scope | DEBT-006 developer reaction (pending) |
| A4 | WAV export off the real-time thread does not introduce underruns in live playback | STORY-07 acceptance test |
| A5 | Tauri command round-trip latency is imperceptible for transport controls (play/stop) | Empirical confirmation during STORY-02/03 (DEBT-002) |

**Open questions.**
- Which `cpal` stream configuration (sample rate, buffer size, channel layout) to use as the default, and whether to expose it in settings or hard-code it for MVP? Decision deferred to STORY-01 implementation.
- Does `hound` support interleaved stereo WAV at 44.1 kHz correctly on all macOS versions in scope? Confirm during STORY-07.

---

## Links

- Business case: `docs/product/business-cases/BC-001-musicware-learning-daw.md`
- Architecture decision: `docs/architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md`
- Container diagram: `docs/architecture/diagrams/c4-container.md`
- UI prototype: `prototypes/spike-0-ui-sketch/` (POC-002)
- Tracker issues: local checklist above (tracker.mode = local; publishable via `to-issues` once a tracker is wired)
- Related PRDs: none yet
- Tech specs: TS-001 (pending — referenced in ADR-0001)
