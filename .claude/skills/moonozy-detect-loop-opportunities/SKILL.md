---
name: moonozy-detect-loop-opportunities
description: >
  Find clips that loop cleanly (start/end align rhythmically, no dangling held notes) and recommend a loop
  count to fill a target span. Spots the building-block loops a beginner can repeat to fill a section. Emits
  loopClip ops (Suggestion, CONTRACT v1). Used by the analyst and arrangement-engineer.
---
# moonozy-detect-loop-opportunities

## Inputs
- `summaries: RecordingSummary[]` (or `recordings: Recording[]` for note-level inspection).
- `targetSpanMs?: number` — the section/region to fill (to compute a loop count).

## Outputs
A Suggestion (`kind:"arrangement"`, CONTRACT §3): per loopable clip, a `loopClip` op with a recommended
`loopCount`, plus a `summary` ("this 2-second beat loops perfectly — repeat it 8× to fill the chorus") and a
loop-quality score in the `rationale`.

## Expected behavior
1. A clip loops cleanly when: its last note-off lands at/just before `durationMs` (no note still held at the
   end), the duration is close to a whole number of bars at its tempo, and density is roughly even start↔end.
2. Score loop quality 0–1 from those signals.
3. If `targetSpanMs` given, `loopCount = round(targetSpanMs / durationMs)`; else just rank loopability.
4. Prefer short, even, drum/bass clips as loops; flag long melodic clips as "better played once".

## Example invocations
- "Which of my clips make good loops?" → ranked loopable clips with quality scores.
- `{ summaries, targetSpanMs: 32000 }` → loop counts to fill a 32-second section.
- "Can I loop my beat through the whole song?" → loopCount + a caveat if it has a held tail.

## Edge cases
- **Held note at clip end** (note-on with no matching off before `durationMs`): low loop score; warn it'll
  retrigger/overlap on repeat.
- **Non-bar-aligned duration**: still loopable but flag "loops will drift from the beat".
- **Single long melodic phrase**: recommend `loopCount: 1` ("plays best once, not looped").
- **targetSpanMs not a multiple of duration**: round and note the leftover gap/overlap.

## Validation rules
- `loopCount ≥ 1` integer.
- Only emit `loopClip` for clips scoring ≥ 0.5; below that, return guidance not an op.
- Preserve clip/recording `id`s (reference integrity).
