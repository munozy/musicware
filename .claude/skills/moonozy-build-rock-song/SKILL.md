---
name: moonozy-build-rock-song
description: >
  One-shot: turn a set of clips into a complete ROCK arrangement — Intro · Verse · Chorus · Bridge · Solo ·
  Outro — running analyze→structure→arrange internally and returning a ready-to-preview plan. Beginner entry
  point for band/song-form music. Emits Suggestion[] (CONTRACT v1).
---
# moonozy-build-rock-song

Composes `moonozy-analyze-song-structure` + `moonozy-generate-arrangement` around verse/chorus song form.

## Inputs
- `summaries: RecordingSummary[]` (or `recordings`), `capabilities`, `lengthSec?` (default ~150), `tempoBpm?` (default 120).

## Outputs
An ordered `Suggestion[]`: a `structure` suggestion (Intro/Verse/Chorus/Bridge/Solo/Outro, with the chorus
repeated) + an `arrangement` suggestion + a `guidance` summary.

## Expected behavior
1. Analyse clips → roles (drums, bass, chords/rhythm, lead/vocal-stand-in).
2. Lay out classic song form sized to `lengthSec`: **Intro → Verse → Chorus → Verse → Chorus → Bridge → Solo →
   Chorus → Outro** (collapse to a shorter form if material/length is small).
3. The **Chorus** is the energy peak and reuses the same clips each time (that's what makes it a chorus);
   verses are sparser; the **Solo** features the lead clip.
4. Loop rhythm/bass through sections; the contrast between verse (fewer parts) and chorus (full) carries the song.
5. Default 120 BPM, 4/4; 8/16-bar sections.

## Example invocations
- "Make a rock song from these." → full song-form plan with repeated choruses.
- `{ summaries, lengthSec: 90 }` → Intro/Verse/Chorus/Solo/Outro short form.
- "I have a riff and a beat." → riff = chorus hook + solo; beat loops throughout.

## Edge cases
- **No distinct lead clip**: skip/shrink the Solo, note "record a lead for a solo section".
- **Only one clip**: use it as the chorus hook; verses = the same clip stripped back (fewer loops); flag repetition.
- **Material too short for the full form**: collapse to Intro/Verse/Chorus/Outro and say so.

## Validation rules
- Chorus appears ≥ 2× and reuses the same clip set each time (consistency).
- All `moonozy-generate-arrangement` validation rules apply.
- Section count scales with `lengthSec`; never emit a 9-section map for a 30-second song.
