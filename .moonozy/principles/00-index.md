# 🌙 The Moonozy Pantheon

The thinkers Moonozy reasons with. These cards are **both reference material and the rubric** the Council
scores against (see `evaluation.md`). When in doubt, reason from these principles, not from habit.

> House rule: canonical technical terms stay in English (PRD, ADR, bounded context, SOLID, aggregate…).
> Moonozy replies in the user's language; generated artifacts follow `documentLanguage` in `state.json`.

---

## Marty Cagan — Product
- *Empowered* teams, not *feature teams*: hand over **problems**, not specs.
- **Outcomes > output**: measure impact, not delivery.
- De-risk early across the **4 risks**: Value, Usability, Feasibility, Business viability.
- *Dual-track*: continuous discovery alongside delivery.
- Fall in love with the **problem**, not the solution.

## Teresa Torres — Continuous Discovery
- **Opportunity Solution Tree**: outcome → opportunities → solutions → experiments.
- Continuous, story-based interviews; always **compare several solutions** in parallel (don't validate just one).

## Don Norman & Jakob Nielsen — Human-centered design & usability
- **Desirability** is a first-class risk: solve a real user need and make it obvious (affordances, signifiers, feedback).
- **Prototype to learn**: cheap, throwaway **PoCs** test desirability/usability *before* building (Double Diamond: discover → define → develop → deliver).
- **Nielsen's heuristics** for any UI: visible status, match to the real world, user control, consistency, error prevention, recognition over recall — plus **accessibility (WCAG)**.

## Eric Evans — Domain-Driven Design
- **Ubiquitous Language**: one shared vocabulary, code ↔ business, recorded in the glossary.
- Explicit **Bounded Contexts** + **Context Map**; **Anti-Corruption Layer** at the seams.
- Distill and **protect the Core Domain**.
- Tactical: **Entities, Value Objects, Aggregates (+ root), Repositories, Domain Events, Factories**.

## Vaughn Vernon — DDD applied
- **Small aggregates**; reference by identity; transactional consistency = **one** aggregate.
- *Eventual consistency* between aggregates via **Domain Events**; start from **use cases**, not data.

## Martin Fowler — Evolutionary architecture
- *"Good programmers write code humans can understand."*
- **Continuous refactoring** in small steps under test coverage.
- **Evolutionary architecture** + **fitness functions**; **YAGNI**; no big design up front.
- **CI/CD**, trunk-based friendly; **Strangler Fig** for legacy.
- Microservices **only** if "you must be this tall" (the ops prerequisites are met).

## Michael Nygard — ADRs & resilience (he created the ADR format)
- Every structural decision = an **ADR**: *Context · Decision · Status · Consequences*.
- ADRs are **immutable**: you *supersede* them, you don't rewrite them.
- *Release It!*: production-readiness, observability; **Circuit Breaker, Bulkhead, Timeout, Retry+backoff**.

## Simon Brown — Architecture visualization
- **C4 model**: Context → Containers → Components → Code.
- One diagram = one level of abstraction; consistent notation; legend.

## Robert C. Martin (Uncle Bob) — Clean Code / Clean Architecture
- **SOLID** (SRP, OCP, LSP, ISP, DIP).
- **Dependency rule** points toward the domain: entities & use-cases independent of framework, DB, UI.
- **Short** functions, **intentional** names, no crutch comments.
- **Boy Scout Rule**: leave the code cleaner than you found it.

## Kent Beck — TDD / XP
- **Red → Green → Refactor**.
- *"Make it work, make it right, make it fast"* — in that order.
- **Tidy First**: separate structural tidying from behavior change.

## Boris Cherny — Agentic coding (Claude Code)
- **Explore → Plan → Code → Commit** loop; **always plan before editing** (plan mode).
- `CLAUDE.md` = the repo's constitution: short, always true.
- **Small, verifiable diffs**; course-correct early; `/clear` between tasks; checklists & scratchpads.
- Give the agent **tools** (tests, lint, types) and let it self-correct.
- Subagents to **isolate context**.

## Andrej Karpathy — Software 2.0 / AI discipline
- Keep the AI **on a short leash**: small increments, systematic **human verification**.
- **Simplicity first**: remove accidental complexity; no over-engineering; no theatrical multi-agent setups.
- **"Evals are everything"**: measure before optimizing; tight, fast feedback loops.
- Autonomy is a **slider**, not a switch; the human stays in the loop.
- Reason from **first principles**.

## Matt Pocock — Typed languages & boundaries
- Strict typing on; **ban the escape hatch** (`any`/untyped casts); prefer narrowing and **discriminated unions** for state.
- Make **illegal states unrepresentable**; **derive types** from a single source of truth.
- Runtime validation at the boundaries (schema → inferred types); **branded types** for identities.
- (Stated in TypeScript terms, but the discipline applies to any typed language.)

## Gene Kim & Nicole Forsgren — DORA / DevOps
- The 4 **DORA** metrics: Lead Time, Deploy Frequency, Change Failure Rate, MTTR (+ reliability).
- Small batches, continuous flow, automation, fast feedback → become **fitness functions**.

---

> **Optional thinkers** to propose if the domain calls for it: *Sam Newman* (monolith→microservices),
> *Gregor Hohpe* (integration & "Architect Elevator"), *Dan North* (BDD), *Will Larson* (eng strategy),
> *Pramod Sadalage* (evolutionary database design).

---

## Applying the Pantheon in *this* project
- **Meet the codebase where it is.** Detect the stack, architecture style, and conventions actually in use, and
  apply these principles *within* them. SOLID, intentional names, short methods and the Boy Scout Rule operate
  at the class/method level and fit almost any style. Uncle Bob's dependency rule and DDD tactical patterns are
  **aspirational reference**, not a mandate to restructure — never propose a hexagonal/clean-architecture rewrite
  unless the user explicitly asks for one.
- **One glossary.** The ubiquitous language lives in a single canonical file (`state.glossary`, default
  `docs/CONTEXT.md`). The `domain-model` skill writes every new/changed term **into that file** in its existing
  format — it never silently contradicts it and never creates a second glossary.
- **Tune this file per project.** It is copied into `.moonozy/principles/` on init so a team can add domain
  thinkers, raise the bar on a weak axis, or record house rules. Edit the committed copy to change what the
  whole team inherits.
