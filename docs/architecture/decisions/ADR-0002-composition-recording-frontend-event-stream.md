# ADR-0002 — Composition recording as frontend event-stream capture/replay

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Architecture + developer (munozy)

## Context

PRD-002 gave musicware a **playable keyboard synth** on top of the STORY-01 Rust/`cpal` real-time engine
(ADR-0001): the UI sends note-on/note-off (and preset) events; the Rust audio thread allocates voices and
renders sound. The natural next want is to **keep what you played** — record a short performance and play it
back — so the keyboard becomes an instrument you can practise and build little compositions on, not just a
momentary noise-maker.

The forces at play:

- **The Rust engine is the project's hard-won, proven asset** (ADR-0001: no GIL, no GC, lock-free,
  `assert_no_alloc`-guarded). Its real-time-safety proofs are load-bearing and fragile. Touching the audio
  thread to add a feature that has **nothing to do with real-time correctness** spends risk for no benefit.
- The UI already funnels **every sound it triggers through one choke point** — `src/synth.ts`
  (`noteOn`/`noteOff`/`setPreset`/`setVolume`). That dispatch point is the single boundary where the UI's
  musical intent crosses to the engine. A recorder needs exactly one place to observe and one place to re-issue.
- This is a **learning DAW** whose comparison class is "GarageBand already exists" (ADR-0001). Recording must
  be cheap to build and reason about; full DAW fidelity (a real file format, sample-accurate timing, disk
  storage) is **not** the bar for this increment.
- The data we want to keep is **low-rate, symbolic control events** (a handful per second), not audio samples.
  ADR-0001 already mandates that **audio samples never cross the UI boundary**.

## Decision

We will implement composition recording **entirely in the frontend, as capture and replay of the UI's
timestamped IPC event stream**, captured and re-issued through the `src/synth.ts` dispatch choke point. **The
Rust audio engine stays untouched.**

- **Capture.** The recorder installs an optional **sink** on the synth dispatch point (`setSynthSink`). While
  armed, every `SynthEvent` (`on` / `off` / `preset`) that the live UI dispatches is tapped and pushed to an
  in-memory buffer, **timestamped with `performance.now()`** relative to the take's start (`useRecorder.ts`).
  Each take is stamped at `t = 0` with the **active preset** (`getCurrentPreset()`) so it always replays with
  the right timbre.
- **Replay.** Playback **re-dispatches** the saved events to the engine via `emit()` on a `setTimeout`
  schedule keyed off each event's timestamp. `emit()` reaches the engine **without** re-tapping the sink, so
  replaying a take never records itself.
- **The take is self-contained.** At stop, any note still held is **auto-closed** with a synthetic note-off at
  the take's duration; an early stop / unmount **releases stuck notes** so a stopped playback never strands a
  voice. A take with no real note-ons is discarded.
- **Persistence.** Takes are persisted as JSON to **`localStorage`** (`recordings.ts`, key
  `musicware.recordings.v1`), with helpers for id, default naming ("Composition N"), and duration formatting.
  The in-memory list is the source of truth; the store is written whenever it changes.
- **Highlight unification.** The keyboard highlight derives from a **single note broadcast** at the dispatch
  point (`subscribeNotes`) with a per-note **refcount**, so live play and replay light the keys identically,
  in sync, from one source of truth (`Keyboard.tsx`).
- **Master volume is excluded.** `setVolume` is an output/monitor setting, not musical content, so it is **not**
  tapped, recorded, or broadcast (see ADR-0003).

This keeps the recorder a **strangler-fig leaf** hanging off the existing dispatch boundary: it adds capability
without migrating or re-architecting the engine.

## Consequences

- **Positive:**
  - **The Rust real-time engine and all its safety proofs are completely untouched** — zero new real-time risk.
  - One observation point and one re-issue point: the recorder is a thin, fully **unit-testable** TypeScript
    module (capture, replay, CRUD), with no IPC mocking of the audio path beyond the existing Tauri commands.
  - Recordings are **tiny symbolic event streams**, not audio — trivial to store, diff, and reason about, and
    consistent with ADR-0001's "audio samples never cross the boundary".
  - Replay reuses the **exact same dispatch path** as live play, so a recording sounds like what was played
    (same engine, same voices, same envelopes) by construction.
  - Live and replayed highlights are **guaranteed in sync** (one broadcast + refcount).
- **Negative (cost accepted):**
  - **Preset buttons do not re-highlight on replay.** Replay re-dispatches `preset` events to the engine, but
    the preset-selector UI state is not driven by the note broadcast, so the on-screen selection does not move
    during playback. (The *sound* is correct; only the button indicator lags.)
  - **`localStorage` only** — no disk file, no export. Recordings are bound to one machine/webview origin and
    are lost if storage is cleared. **No MIDI / SMF export** yet.
  - **No sample-accurate timing.** Replay scheduling is **`setTimeout`-based** and inherits the event loop's
    jitter; long or dense takes can drift by a few ms per event relative to capture.
- **Risks (with mitigation / fitness function):**
  - **`localStorage` quota / corruption.** *Mitigation:* `loadRecordings` tolerates missing/corrupt storage by
    returning `[]`; writes are wrapped and log on failure. *Fitness function:* the existing vitest suite covers
    load/save tolerance and the take lifecycle (auto-close, stuck-note release, empty-take discard).
  - **Replay jitter becomes audible** for longer compositions. *Mitigation / future story:* if/when fidelity
    matters, move scheduling to a sample-clock (engine-side timeline) — a deliberately **deferred** decision,
    not this increment's.
  - **Format lock-in to `localStorage` JSON.** *Mitigation:* the `Recording`/`RecEvent` model is plain,
    versioned data (`...v1`); a later MIDI/SMF or disk-export ADR can supersede the storage choice without
    touching capture/replay semantics.

## Alternatives considered

1. **Rust-side capture inside the audio engine** — record `NoteEvent`s as they drain off the ring buffer on the
   audio thread. *Rejected:* it puts recording state and persistence concerns **inside the real-time path**,
   directly threatening ADR-0001's no-alloc / no-lock proofs and the `assert_no_alloc` guard, for a feature that
   needs none of the real-time thread's guarantees. The UI already has every event before it crosses the
   boundary — capturing there is strictly cheaper and safer.
2. **A standard MIDI / SMF file format** — capture into Standard MIDI File format for interoperability and a
   real export. *Rejected for now:* musicware's note model is explicitly **pitch math, not MIDI I/O** (per the
   glossary and PRD-002), and there is no MIDI hardware in scope. Adopting SMF would add an encoding/decoding
   surface and a tick/tempo model the rest of the app does not have, for interop nobody has asked for. Left as a
   clean future supersession of the storage/export choice.
3. **Recording the output audio via the Web Audio API** — tap a `MediaStreamDestination` / `MediaRecorder` on
   the rendered sound. *Rejected:* the audio is rendered in **Rust/`cpal`**, not in the webview — there is no
   Web Audio graph to tap. It would also store opaque audio blobs (heavy, non-editable) and **violate
   ADR-0001's "audio samples never cross to the UI"**.
4. **A dedicated backend store / SQLite** (Tauri filesystem or a bundled DB) — durable, exportable, multi-machine.
   *Rejected for this increment:* over-engineered for keeping a few short symbolic takes. It adds a schema,
   migrations, and a Rust persistence surface with no payoff yet. `localStorage` is the YAGNI choice; a durable
   store is a later ADR once disk export or sync is actually wanted.
5. **Do nothing** — keep the keyboard momentary-only. *Rejected:* recording is the obvious next learning step
   and is achievable as a pure frontend leaf with no engine risk.

## Links
PRD: [PRD-002](../../product/prds/PRD-002-playable-keyboard-synth.md) · Issues: PR #1 (branch `feat/composition-recorder` @ f66550d) · Related/superseded ADRs: builds on [ADR-0001](ADR-0001-react-tauri-rust-audio-engine.md) (dispatch boundary, "audio samples never cross the UI"); related to [ADR-0003](ADR-0003-master-volume-post-render-limiter.md) (volume deliberately excluded from capture) · Tech-spec: — · Glossary terms touched: ADDS "Recording", "Take", "Replay" (synthesis terms); uses note event, preset, Tauri command, voice.
