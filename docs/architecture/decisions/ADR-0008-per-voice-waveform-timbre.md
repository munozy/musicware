# ADR-0008 — Per-voice waveform (per-note timbre)

- **Status:** Accepted (2026-06-26). Reduced-bar caveat: implemented inline (org API spend limit blocked the
  adversarial review + Council); a re-review is owed (DEBT-034). Resolves DEBT-036; implements ADR-0007's V2a.
- **Context owner:** the Rust audio engine (`src-tauri/src/audio.rs`).

## Context

The Song-arrangement scheduler (ADR-0007) plays each clip by emitting its `set_preset` then its notes into the
existing engine. But `render_block` renders **all** sounding voices with a single **global** waveform (read once
per block from the `set_preset` `AtomicU8`). Each `Voice` already captures `v.preset` at note-on for its
**envelope**, **drum** dispatch, **bell** partials, and **theremin** LFO — only the base **waveform** stayed
global (STORY-K4: "waveform applies live to all voices; held notes re-timbre live").

Consequence in the arrangement: when two clips with **different** instruments overlap, the global preset is
whichever clip's `set_preset` fired last, so the other clip's still-sounding notes render with the **wrong**
instrument. Users hear overlapping tracks as inconsistent / wrong (DEBT-036, the ADR-0007 "per-track-instrument
tension"). This is the dominant remaining arrangement complaint.

## Decision

**Render each voice with its own captured preset's waveform** — `PRESETS[v.preset as usize].waveform` — instead
of a single global waveform. Remove the `waveform` parameter from `render_block`; the voice loop derives the
waveform per voice (the drum/bell/theremin branches already key off `v.preset`/the per-voice waveform). Voices
already capture `v.preset` at note-on, so no new note-event field or Tauri command is needed — the scheduler's
existing `set_preset`-before-`note_on` ordering means each note captures the preset active when it starts.

This is the simpler of ADR-0007's two V2a options (capture-at-note-on vs tagging every `NoteEvent` with a
preset); it reuses the per-voice capture already proven in-tree for the drum branch (ADR-0005).

## Consequences

- **(+) Overlapping different-instrument clips/notes each play their own timbre** — fixes the arrangement bug
  (DEBT-036); overlapping tracks now sound consistent.
- **(+) Standard synth behaviour** — a held note keeps the patch it was struck with; new notes get the new patch.
- **(−) Supersedes STORY-K4's live re-timbre** — switching the preset no longer re-timbres already-held notes.
  This is a deliberate behaviour change (the `switching_waveform_changes_rendered_output` test is updated to the
  new per-voice expectation).
- **(−) `render_block` is no longer a harness for arbitrary non-preset waveforms** (Saw/Square/Triangle aren't
  any preset's waveform); their boundedness is tested via `eval_waveform` directly, which is the real invariant.
- **RT-safety preserved** — the per-voice waveform is a plain array index (`PRESETS[...]`): no allocation, no
  lock. The `assert_no_alloc` guard, `cargo test`, and the on-push 16-voice audio gate cover it.

## Alternatives considered

- **Tag every `NoteEvent` with a preset** (ADR-0007 V2a alt): more invasive (ring-buffer event grows, new
  command surface). Rejected — capture-at-note-on is sufficient given the scheduler emits preset-then-note.
- **Keep global + surface a UI warning only** (the cheap interim): doesn't fix the sound. Rejected as the
  primary fix; the warning is now unnecessary because the timbres are correct.
- **Per-track sub-mixers / full DSP graph** (ADR-0007 V2b/V2c): out of scope; this change is the minimal V2a.
