---
name: moonozy-build-cinematic-song
description: >
  One-shot: turn a set of clips into a complete CINEMATIC arrangement — Intro · Tension · Climax · Resolution —
  a single long swell of building then releasing energy. Runs analyze→structure→arrange internally and returns
  a ready-to-preview plan. Beginner entry point for trailer/score moods. Emits Suggestion[] (CONTRACT v1).
---
# moonozy-build-cinematic-song

Composes `moonozy-analyze-song-structure` + `moonozy-generate-arrangement` around a single rising→falling arc.

## Inputs
- `summaries: RecordingSummary[]` (or `recordings`), `capabilities`, `lengthSec?` (default ~120), `tempoBpm?` (default 90).

## Outputs
An ordered `Suggestion[]`: a `structure` suggestion (Intro/Tension/Climax/Resolution) + an `arrangement`
suggestion (parts accumulate toward the Climax, then thin out) + a `transition` note + a `guidance` summary.

## Expected behavior
1. Analyse clips → roles (atmos/pad, low drone/bass, rhythmic pulse, melodic theme).
2. Lay out one big arc: **Intro** (sparse, atmospheric — one pad/theme) → **Tension** (slowly add parts, repeat
   a rising motif) → **Climax** (everything, biggest moment) → **Resolution** (strip back to the opening theme,
   let it fade).
3. Energy is **monotonic up to the Climax**, then down — arrange by progressively adding clips, then removing.
4. Slow tempo, long sections; loop a motif under the Tension to build dread/anticipation.
5. The signature move is the long crescendo into the Climax (op if capable, else guidance).

## Example invocations
- "Make this cinematic / epic / trailer-like." → 4-section rising arc.
- `{ summaries, lengthSec: 180 }` → a longer, slower build.
- "I have a pad and a drum hit." → pad carries Intro/Resolution; drum hit marks the Climax.

## Edge cases
- **No melodic theme**: use the most sustained clip as the theme; flag it.
- **Only percussive clips**: build tension with accelerating/denser loops; note "a melody would give this a theme".
- **Too short for a slow build**: compress to Intro/Climax/Resolution and say so.

## Validation rules
- Energy profile is single-peaked (rises to Climax, falls after) — assert the section order.
- All `moonozy-generate-arrangement` validation rules apply.
- One crescendo transition only; no effect pile-up.
