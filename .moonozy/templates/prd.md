# PRD-00N — <title>

> The **single** PRD shape for Moonozy — used by both paths: a `moonozy-product` interview and the `prd`
> synthesis skill. Owner: Product. Cagan/Torres up front (problem → outcome → risks), execution detail at the
> back (stories, decisions, tests). Lives in `docs/product/prds/` (in-repo source of truth); sliced work items
> go to the configured tracker via `to-issues`. Use the project glossary's vocabulary throughout; respect ADRs
> in the area you touch.

## Problem & opportunity
<The problem from the user's perspective. Why now? Size of the opportunity.>

## Outcomes & success metrics
<The measurable outcome — e.g. "−20% involuntary churn within 2 quarters". Not a feature/output count.>

## The 4 risks (and how each is addressed)
- **Value** — will they use/buy it? <evidence / experiment>
- **Usability** — can they figure it out? <prototype / heuristics / a11y>
- **Feasibility** — can we build it? <architect feasibility note / ADR link>
- **Business viability** — legal, finance, GTM, ops? <note>

## Users / personas
<Who, in their own words. Link discovery evidence.>

## Solution narrative (not a spec)
<A story of the experience from the user's perspective — not a list of fields.>

## User stories
<A LONG numbered list. Format: "As an <actor>, I want <feature>, so that <benefit>." Cover all aspects.>

## Scope — Now / Next / Later (+ Out of scope)
- **Now / Next / Later:** …
- **Out of scope:** <explicitly what this PRD does not cover>

## Implementation decisions
<Modules to build/modify, the interfaces touched, schema changes, API contracts, architectural decisions.
Do NOT include file paths or code snippets (they go stale). Exception: a prototype-derived snippet that encodes
a decision more precisely than prose (state machine, reducer, schema, type shape) — trim to the decision-rich bits.>

## Testing decisions
<What makes a good test here (test external behavior, not implementation details) · which modules are tested ·
prior art (similar tests in the codebase). Use the project's existing test framework and runner.>

## Discovery evidence & open questions
<Opportunity Solution Tree branch, interviews, data. What we still don't know (each maps to a discovery activity).>

## Links
PoC: · ADR(s): · Tracker issues: · Tech-spec(s): · Related PRDs:
