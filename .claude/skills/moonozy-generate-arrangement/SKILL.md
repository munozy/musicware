---
name: moonozy-generate-arrangement
description: >
  Produce a full track + clip-placement plan from enriched composition summaries and a section structure:
  which clip on which track, at what time, looped/transposed to fill each section's energy. Emits
  createTrack/placeClip/loopClip/transposeClip ops (Suggestion, CONTRACT v1). The core arranging verb.
---
# moonozy-generate-arrangement

Used by `moonozy-arrangement-engineer` (and internally by the `moonozy-build-*-song` one-shots).

## Inputs
- `summaries: RecordingSummary[]` (enriched, with roles) — CONTRACT §1.
- `sections: Section[]` (with per-section energy) — CONTRACT §2.
- `capabilities: string[]`, `tempoBpm?`, `timeSig?`, `existingTracks?: Track[]`.

## Outputs
An `arrangement` Suggestion (CONTRACT §3) with ordered `ops`:
`createTrack` (one per role/instrument) → `placeClip` / `loopClip` / `transposeClip`. Times bar-aligned and
non-negative; tracks created before clips reference them.

## Expected behavior
1. Map roles → tracks (drums, bass, chords/pad, lead); set each track's `presetIndex` from its clip's timbre.
2. For each section, add/keep parts per its energy: intro = pad only; build = +bass/+drums; drop/chorus = all;
   breakdown = strip to 1–2 parts; outro = fade material.
3. Loop short clips to span a section (`loopCount = ceil(sectionLen / clipLen)`); transpose to the song key.
4. Avoid obvious mud (don't stack two parts in the same octave) — leave fine balance to the mixer.
5. Respect `capabilities`: V1 emits only track/placement/loop/transpose ops.

## Example invocations
- `{ summaries, sections, capabilities:["v1"] }` → tracks + placements realising the arc.
- "Build the drop section only." → ops scoped to that section's time range.
- "Reuse my 4-bar loop across the verse." → `placeClip` + `loopClip` spanning the verse.

## Edge cases
- **Fewer clips than roles**: build with what's there; add a guidance note ("a bass clip would fill this out").
- **One clip only**: place + loop it across sections with transpose variation; don't invent parts.
- **Clip longer than a section**: trim (`trimEndMs`) rather than overrun the next section.
- **Per-track-instrument overlap** (ADR-0007): if two differently-timbred clips must sound at once, place them
  but flag "the V1 engine plays one instrument at a time — these may not both sound".

## Validation rules
- Reference integrity: every `recordingId`/`trackId` resolves (CONTRACT §4).
- No `later` ops (gain/pan/fades) when `capabilities` lacks them — downgrade to guidance.
- `loopCount ≥ 1`; `startMs ≥ 0`; trims valid; ops ordered so creation precedes reference.
