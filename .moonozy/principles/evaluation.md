# 🌙 Moonozy self-evaluation — the 0–100 rubric

The Council (`moonozy-council`) applies this rubric on **every** substantive iteration. It is **read-only**: it
judges, it never edits. Scores are honest and specific — cite examples from the diff/artifact; no sycophancy.

## Rubric — 5 axes × 20 = 100

| Axis | Thinkers | What we check |
|---|---|---|
| **Product & UX value** | Cagan, Torres, Norman, Nielsen | Real & validated problem · measurable outcomes · the 4 risks addressed · desirability & usability (heuristics/a11y) · tied to an Opportunity Solution Tree |
| **Domain integrity** | Evans, Vernon | Consistent ubiquitous language (aligned with the project glossary) · clean bounded contexts · core domain protected · small, healthy aggregates |
| **Architectural soundness** | Fowler, Nygard, Brown | Decisions recorded in ADRs · evolutionary & simple (YAGNI) · production-ready/resilient (timeouts, retries, observability) · C4 current |
| **Code craft** | Martin, Beck, Pocock | SOLID · TDD (tests green) · strict typing / no escape hatches · clear names · small diffs · Boy Scout Rule |
| **AI & flow discipline** | Karpathy, Cherny, DORA | Verifiable increments · evals/fitness functions present · minimal accidental complexity · tight feedback loop · **DORA scored against the project's real pipeline** (`state.ci`): commit gates, CI checks, and deploy flow — the local gate is the fast pre-CI subset |

> Score each axis **/20**, sum to **/100**. An axis that is *not applicable* to the current increment
> (e.g. no UI in a pure-backend refactor) scores on its applicable sub-criteria and is noted as scoped —
> never silently inflated.

## Council output format (ALWAYS, in this order)

1. **Score table** — the 5 axes each `/20` and the total `XX/100`.
2. **Embodied verdicts** (2–4 sentences each), mandatorily including:
   - *"What would Andrej Karpathy think of this orchestration?"*
   - *"Would Marty Cagan find this relevant?"*
   - plus the thinker behind the **lowest-scoring axis** (their sharpest, constructive critique).
3. **At most 3 concrete actions** to gain points, ranked by impact/effort.

## Iteration policy (the short leash)

- **Default threshold: 85/100** (configurable in `state.json` → `evaluation.threshold`).
- **Below threshold:** list the gaps, apply **low-risk fixes within the current phase**, then re-score.
  **Max 3 loops.** After that, record residual debt in `state.json.openDebt` and hand back to the human.
- **At/above threshold:** propose the commit.
- **Always logged:** every evaluation → `.moonozy/evaluations/YYYY-MM-DD-HHMM.md`; score + history → `state.json`
  (`evaluation.lastScore`, `evaluation.history`) so progress over time is visible.

## Scoring discipline
- Reward **outcomes and evidence**, not output volume (Cagan/Karpathy).
- Penalise **theatrical complexity**: an over-engineered multi-agent dance for a one-line task loses points on
  *AI & flow discipline* (Karpathy).
- A red test, a type error, or a bypassed commit gate (e.g. `git commit --no-verify`) caps *Code craft* and
  *AI & flow discipline*.
- Drift from the project glossary's terminology caps *Domain integrity*.
