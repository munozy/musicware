---
name: moonozy-build-electronic-song
description: >
  One-shot: turn a set of clips into a complete ELECTRONIC arrangement — Intro · Build-up · Drop · Breakdown ·
  Outro — by running analyze→structure→arrange internally and returning a ready-to-preview plan. The lowest-
  friction beginner entry point for dance/EDM. Emits Suggestion[] (CONTRACT v1).
---
# moonozy-build-electronic-song

A template builder. Composes `moonozy-analyze-song-structure` + `moonozy-generate-arrangement` around the
electronic structure so a beginner gets a whole song from one action.

## Inputs
- `summaries: RecordingSummary[]` (or `recordings`), `capabilities`, `lengthSec?` (default ~90), `tempoBpm?` (default 124).

## Outputs
An ordered `Suggestion[]` (CONTRACT §3): a `structure` suggestion (the 5 sections) + an `arrangement`
suggestion (tracks + clips) + a `transition` note for the pre-drop + a `guidance` summary.

## Expected behavior
1. Analyse clips → roles (need at least a beat/bass and one melodic part for a satisfying drop).
2. Lay out sections sized to `lengthSec`: **Intro** (pad/atmos), **Build-up** (+bass, +drums, rising energy),
   **Drop** (everything, the peak), **Breakdown** (strip back), **Outro** (fade material).
3. Place clips per energy; loop the beat/bass through Build/Drop; reserve the lead/hook for the Drop.
4. Add the signature **silence-before-the-drop** transition (op if capable, else guidance).
5. Default tempo 124 BPM, 4/4; 16/32-bar sections.

## Example invocations
- "Make these into a dance track." → full 5-section electronic plan.
- `{ summaries, lengthSec: 60 }` → tighter 1-minute version.
- "I only have a beat and a melody." → still builds; pads/bass sections noted as "add later".

## Edge cases
- **No percussive/drum clip**: build anyway; flag "a beat would make the drop hit — try the Drums preset".
- **No melodic clip for the drop**: use the densest available clip as the hook; lower confidence.
- **Very short material (< 4s total)**: rely on looping; warn the song will be repetitive.

## Validation rules
- Emits the canonical 5 electronic sections, bar-aligned, in order.
- All `moonozy-generate-arrangement` validation rules apply (reference integrity, capability gate).
- Pre-drop transition is the only effect proposed (no effect pile-up).
