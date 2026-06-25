---
name: moonozy-analyze-song-structure
description: >
  Summarise a set of saved compositions and detect the energy arc / latent structure across them — key, tempo,
  density, role per clip, and whether they already imply Intro→build→peak→outro. Use as the first step of
  arranging, or standalone to "understand what I've got". Reads symbolic events, not audio (CONTRACT v1).
---
# moonozy-analyze-song-structure

The analysis verb. Used by `moonozy-composition-analyst` and `moonozy-song-architect`.

## Inputs
- `summaries: RecordingSummary[]` (or `recordings: Recording[]` to derive them) — CONTRACT §1.
- `goal?: { genre?, lengthSec? }` — optional, to bias role/arc interpretation.

## Outputs
An `analysis` Suggestion (CONTRACT §3), `ops: []`, payload =
- enriched `RecordingSummary[]` (key/tempo/density/pitchRange/suggestedRole, each with a confidence + the cue used),
- a detected **energy arc** (ordered low→high ranking of the clips by density/register),
- **clash flags** (clips in different keys; two dense parts in the same register).

## Expected behavior
1. For each clip, build a pitch-class histogram → estimate key (Krumhansl-lite / most-common-triad heuristic).
2. Inter-onset intervals → estimate tempo; irregular ⇒ null.
3. density = note-ons ÷ (durationMs/1000); role from register + density + preset (Drums preset ⇒ `drums`).
4. Rank clips into an energy arc; note which would make a natural intro (sparse) vs peak (dense).
5. State confidence honestly; never invent a key from < 4 distinct pitches.

## Example invocations
- "Analyse these 8 clips." → enriched summaries + arc.
- `{ summaries: [...], goal: { genre: "rock" } }` → roles biased toward verse/chorus reading.
- "Do my clips already form a song shape?" → energy arc + "you have a natural intro and peak; you're missing a breakdown".

## Edge cases
- **Drums preset** (4): no key/pitchRange (unpitched) — return `pitchRange: null`, role `drums`.
- **Empty / 1-note clip**: role `unknown`, key/tempo null, confidence ≤ 0.2.
- **No notes (preset-only take)**: skip, flag "this clip has no notes".
- **Wildly irregular timing**: tempo null, don't guess.

## Validation rules
- Never emit non-empty `ops` (analysis is read-only).
- Every estimate has a `confidence` in [0,1]; key/tempo null rather than low-quality guess.
- Output one entry per input summary; preserve `id`s exactly (reference integrity, CONTRACT §4).
