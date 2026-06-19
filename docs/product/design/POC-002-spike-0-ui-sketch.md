# POC-002 — Spike 0: MVP UI sketch

> Owner: developer (solo). Norman/Nielsen/Torres: prototype to **learn**, throwaway by design.
> Lives in `prototypes/spike-0-ui-sketch/` — never production source. Graduating requires a linked PRD *and* ADR.

## Question / risk being tested
**Usability / scope** (the "Usability: medium" risk in [BC-001](../business-cases/BC-001-musicware-learning-daw.md)): is the MVP surface — transport, 4 tracks, a looped region, gain/pan, export — even drawable and coherent at the locked scope, before any latency work? A 30–60 min sketch to pressure-test the scope boundary.

## What was built
A single self-contained low-fidelity HTML wireframe (`index.html`) showing the entire MVP surface on one screen: transport bar, 4 track lanes (arm/mute/solo + gain/pan), a clip, a loop region over bars 1–4, a playhead, and a master strip with Export. Greyscale + dashed borders to signal "sketch, not spec". Labels map 1:1 to the glossary terms in `docs/CONTEXT.md`.

Location: `prototypes/spike-0-ui-sketch/` (+ `README.md`).

## How it was tested
Self-review against the MVP acceptance test and the glossary. To be reacted to by the developer (and optionally a friend): does it cover the acceptance test? Is anything missing or out of scope? Nielsen quick-check: visible transport status, recognition over recall (controls labelled), match to real-world DAW conventions.

## What we learned
_Pending — fill after reacting to the sketch: is it buildable in React at MVP scope? what to cut, what's missing?_

## Decision
- [ ] **Graduate** (→ needs PRD + ADR; hand off to architect/engineer)
- [ ] **Iterate** (another sketch round)
- [ ] **Drop** (and why)

_This sketch primarily informs PRD-001 (MVP scope) — it is not itself production UI._

## Status (mirror in state.prototypes)
`exploring` — linkedPRD: PRD-001 (pending) · linkedADR: —

## Links
PRD: PRD-001 (pending) · ADR: — · Discovery: BC-001 (Spike 0)
