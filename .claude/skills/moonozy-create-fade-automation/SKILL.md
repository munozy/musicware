---
name: moonozy-create-fade-automation
description: >
  Generate fade-in/fade-out and volume (or any-parameter) automation as concrete ops — OR, when the host engine
  can't yet apply them, the equivalent by-ear instruction. Strictly capability-gated (CONTRACT v1 §5). Used by
  moonozy-transition-designer; the bridge to the future automation system.
---
# moonozy-create-fade-automation

## Inputs
- `target: { clipId? , trackId? }` — what to fade/automate.
- `request: { type: "fadeIn"|"fadeOut"|"automation", param?: "volume"|"pan"|"filterCutoff"|"reverbAmount"|"delayAmount", curve?: "linear"|"exp", fromValue?, toValue?, startMs, endMs }`.
- `capabilities: string[]`.

## Outputs
A Suggestion (`kind:"automation"`, CONTRACT §3):
- if capable → `addFade` or a series of `addAutomationPoint` ops describing the curve (≥ 2 points: start + end,
  more for shaped curves);
- if NOT capable → `ops: []` + a precise by-ear `summary` ("drag the master volume down over the last 4 bars")
  + a `needs:` tag.

## Expected behavior
1. Translate a fade into automation points on the chosen `param` (default `volume`): fadeIn = 0→1 over
   [startMs,endMs]; fadeOut = 1→0; exp curve = add a mid point.
2. For generic automation, sample the curve into 2–8 points (enough to read smooth, few enough to stay simple).
3. Clamp values to the param's range (volume/reverb/delay 0..1; pan −1..1; filterCutoff a normalised 0..1).
4. Respect `capabilities` above all — never emit an op the host can't apply.

## Example invocations
- `{ target:{trackId:"tk-pad"}, request:{type:"fadeIn", startMs:0, endMs:4000}, capabilities:["v1","fades"] }` → `addFade` op.
- Same with `capabilities:["v1"]` → guidance: "let the pads come in gently by hand" + `needs:fades`.
- "Automate the filter opening through the build." → `addAutomationPoint[]` on `filterCutoff` (if capable).

## Edge cases
- **No capability**: always degrade to guidance, never silence.
- **endMs ≤ startMs**: reject (validation) — fades need positive duration.
- **Unknown param**: accept (forward-compatible "any future parameter") but tag `needs:param:<name>` so the host
  can refuse gracefully.
- **Fade longer than the clip/section**: clamp to the clip/section bounds and note it.

## Validation rules
- `endMs > startMs ≥ 0`; values clamped to range; ≥ 2 automation points per curve.
- Capability gate is mandatory (CONTRACT §4 rule 4 + §5).
- Param ∈ the documented namespace or explicitly tagged as future.
