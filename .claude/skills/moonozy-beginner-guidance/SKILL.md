---
name: moonozy-beginner-guidance
description: >
  Translate any music suggestion, term, or arrangement into warm, jargon-free, encouraging language a complete
  beginner understands — what to do and why it helps, in one line each. The plain-language layer over every
  other skill. Emits a guidance Suggestion (CONTRACT v1). Used by moonozy-beginner-guide; callable standalone.
---
# moonozy-beginner-guidance

## Inputs
- `suggestions?: Suggestion[]` — the recommendations to translate, OR
- `term?: string` — a single word to explain (e.g. "pan", "drop", "quantize"), OR
- `arrangement?: Arrangement` — to narrate the whole song in plain words.
- `skillTier?: "beginner" | "curious" | "confident"` (default beginner) — how much to gloss.

## Outputs
A `guidance` Suggestion (CONTRACT §3), `ops: []`: one short, friendly entry per input suggestion (or one
explanation for a `term`, or a 2–3 sentence narration for an `arrangement`), each ending in a one-line
"why it helps" framed around how the song *feels*. Optionally a single "what next?" nudge.

## Expected behavior
1. Replace or immediately gloss every term; never leave jargon bare ("pan = where a sound sits left↔right, like
   a position on a stage").
2. Mirror the source `confidence` — don't oversell a shaky idea; encourage honestly.
3. Keep each entry to ~1–2 sentences; lead with the action, follow with the feeling.
4. For `term`, define it AND point to where it appears in the user's song if an arrangement is in context.
5. Add nothing musical — translate only; if a suggestion is wrong, say "you can skip this", never invent a fix.

## Example invocations
- `{ suggestions: [...] }` → a friendly bullet per suggestion + "what next?".
- `{ term: "quantize" }` → "quantize nudges your notes onto the beat so the rhythm feels tight — try it if your timing feels loose."
- `{ arrangement }` → "Your song starts soft, builds up, hits a big moment at 0:32, then winds down. Press play!"

## Edge cases
- **Empty suggestions**: return one encouraging "you're all set — press play and tweak anything you like".
- **Unknown term**: say so plainly and offer the closest concept ("I'm not sure about that one, but here's something similar…").
- **Confident-tier user**: gloss less, keep the "why", drop the hand-holding.
- **Contradictory suggestions in the batch**: present both as options, not commands ("you could… or…").

## Validation rules
- Zero jargon in any `summary`; any term in a `rationale` is explained in the same sentence.
- Never emit `ops` (guidance is non-actionable by construction).
- One entry per input suggestion; preserve their order so the host can pair them up.
- Tone: warm, never condescending; confidence honest, never inflated.
