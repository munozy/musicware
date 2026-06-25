---
name: moonozy-suggest-transition
description: >
  Propose the single best transition between two adjacent sections (or the song's start/end) so the energy
  change feels intentional — fade, riser, filter sweep, drop-out, silence-before-the-drop. Capability-gated
  ops or plain guidance (Suggestion, CONTRACT v1). Used by moonozy-transition-designer.
---
# moonozy-suggest-transition

## Inputs
- `from: { name, endMs, energy? }`, `to: { name, startMs, energy? }` — the two sections at the seam.
- `arrangement?: Arrangement` (to know which parts are playing), `capabilities`, `tempoBpm?`.

## Outputs
A `transition` Suggestion (CONTRACT §3): a beginner-readable `summary`, a `rationale`, and `ops` **only** if the
host supports them (`addFade`, `addAutomationPoint`, or a `placeClip` for a riser); otherwise `ops: []` with a
precise by-ear instruction and a `needs:` capability tag.

## Expected behavior
1. Read the energy delta (`to.energy − from.energy`).
2. **Rising** (delta > 0): silence-before-the-drop, riser clip into the downbeat, or open-filter sweep.
3. **Falling** (delta < 0): drop parts out, quick fade, or close-filter.
4. **Flat**: a subtle one — a one-bar drum fill or a single part entering/leaving.
5. Start of song ⇒ fade/swell in; end ⇒ fade out.
6. Pick exactly ONE technique (beginners don't want a stack). Tag the technique + any required capability.

## Example invocations
- `{ from:{name:"Build-up",...}, to:{name:"Drop",...}, capabilities:["v1"] }` → "cut to silence for a beat before the drop" (guidance, `needs:automation`).
- "Smooth verse→chorus." → bring the drums in one bar early (`placeClip`, applyable in V1).
- "End the song nicely." → 4-bar fade-out (op if capable, else "slide the master volume down at the end").

## Edge cases
- **No capability for the ideal move**: still recommend it as guidance; never stay silent.
- **Identical energy / same parts both sides**: suggest a minimal fill or "no transition needed — it already flows".
- **Seam in the middle of a looping clip**: align the transition to the loop boundary, not mid-loop.

## Validation rules
- At most one technique per seam.
- No op the host can't apply (CONTRACT §4–5) — downgrade to guidance + `needs:` tag.
- Times within the two sections' range; non-negative.
