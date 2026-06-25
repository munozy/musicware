---
name: moonozy-mix-review
description: >
  Critique an existing arrangement's balance — simultaneous-part density, register/role clashes, panning gaps,
  and headroom against the master limiter — and return up to ~3 ranked, fixable problems. Capability-gated ops
  or by-ear guidance (Suggestion, CONTRACT v1). Used by moonozy-mixing-advisor; callable standalone.
---
# moonozy-mix-review

## Inputs
- `arrangement: Arrangement` (tracks + clips + sections) — CONTRACT §2.
- `summaries: RecordingSummary[]` (for density/register), `capabilities: string[]`.

## Outputs
A `mix` Suggestion (CONTRACT §3): up to ~3 ranked findings, each with a plain `summary`, a `rationale`, and a
fix as an op (`setTrackGainDb`/`setTrackPan`) **if** capable, else `ops: []` + a by-ear instruction. Honest
`confidence` (mixing is subjective).

## Expected behavior
1. Build a timeline of simultaneous clips; find the densest moments.
2. Flag: > ~4 simultaneous parts (clutter / limiter pumping risk); two parts in the same octave (mud); two
   leads at once (clash); everything centre (no width).
3. Rank findings by impact; propose the *simplest* fix each (turn one down, move one out of the way, pan apart).
4. Frame headroom against musicware's MASTER_GAIN = 1/16 + post-render limiter (ADR-0003).
5. Cap at 3 findings — a beginner won't action ten.

## Example invocations
- "Review my mix." → top 2–3 problems + simplest fixes.
- "Why does the drop sound muddy?" → "bass and pad share the low notes; move the pad up an octave".
- `{ arrangement, capabilities:["v1","per-track-gain"] }` → `setTrackGainDb` ops; without it → by-ear guidance.

## Edge cases
- **Sparse arrangement / no clashes**: return "this sounds clean — nothing to fix" (don't manufacture problems).
- **No per-track gain capability**: all fixes become guidance ("lower the Pads track by ear").
- **Drums everywhere**: check the one-shot voice load (drums self-free) before flagging a voice-ceiling risk.
- **Single track**: skip balance checks; comment on arrangement fullness instead.

## Validation rules
- ≤ 3 findings; each must have an actionable fix (op or instruction).
- No op outside `capabilities` (CONTRACT §4–5).
- Never recommend deleting user content; "mute" or "lower", not "remove".
