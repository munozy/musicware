# DISCOVERY-001 — Arrangement Value & Usability
## De-risking PRD-004 OQ-3 Before the Song-Mode Build

> Owner: developer (solo conductor). Date: 2026-06-25. Status: **Active — Revised 2026-06-25**.
> Resolves: DEBT-025 (OQ-1/OQ-2 judgment gate, PRD-004).
> Decision this feeds: proceed to build the multi-track arrangement workspace (PRD-004 Solution A)
> after validating the recombination UX via a cheap prototype, OR pause if beginners cannot engage
> the duplicate→rearrange→combine loop without assistance.
> Style: Teresa Torres continuous-discovery; Cagan 4-risks framing.

---

## Revision note (2026-06-25)

**What changed and why.** The original DISCOVERY-001 framed OQ-1 as "are Takes deliberate song
parts (named verse/bass/etc.)" and OQ-2 as "does the developer return cross-session to assemble
them?" It proposed observing two recorder sessions and used the n=3 localStorage data as a
weak starting signal.

A product clarification from the owner invalidates the core premise of that framing. Compositions
(Takes) are **not intended to be complete songs**. Their primary purpose is to be **reusable
building blocks** — short musical ideas meant to be duplicated, rearranged, and combined with
other Compositions to form a song (see `docs/CONTEXT.md` — "Composition = reusable building
block; short/default/incomplete is expected" and "Recombination workflow"). Evaluating a
Composition by duration, or expecting role-specific naming ("verse", "bass"), misreads the design.

Three specific corrections follow from this:

1. The n=3 evidence verdict ("weakly exploratory / inconclusive against Solution A") was the
   misread. Short, default-named, ≤13s Takes with varied presets are **exactly what valid
   building blocks look like**. Their shape is neutral — it tells us nothing about whether users
   want to recombine them, because no recombination affordance exists yet.

2. A1 (role-specific naming as the OQ-1 binding signal) is an **invalid proxy**. A building block
   is reusable regardless of its name. The criterion has been removed as a gate condition.

3. Solution B ("longer single Takes + section markers") **contradicts the building-block design**
   (monolithic vs modular). It is demoted/retired as off-vision.

The corrected open risk is not "is multi-track a real want" — the product vision answers that
directly with Solution A. The remaining risk is **desirability and usability of the recombination
UX**: will beginners actually engage the duplicate→rearrange→combine loop, and is the arrangement
workspace (DESIGN-002) learnable without instruction?

This revision re-aims the discovery instrument to a **clickable prototype test** (OQ-3) rather
than usage-log observation of a recorder that has no combine affordance.

---

## 1. Positioning on the Opportunity Solution Tree

PRD-004's OST branch (corrected):

```
Outcome: developer assembles a complete multi-section song from saved Compositions
  └─ Opportunity: Compositions are isolated islands — no way to recombine building blocks in time
        ├─ Solution A — symbolic multi-track arrangement timeline (PRD-004 V1)       ← ON VISION
        │    Experiment: OQ-3 (can a beginner, given 3–5 existing Compositions,
        │    assemble a recognisable short song via the arrangement UX?) → this plan
        ├─ Solution B — longer single-Take + in-Take section markers                 ← RETIRED
        │    Contradicts the building-block design. See §2.
        └─ Solution C — AI-generated arrangement (deferred; US-26 stub is vehicle)
```

This plan operationalizes OQ-3 only. OQ-1 and OQ-2, in their original form (role-naming + usage
logs of the existing recorder), are superseded — see §2. OQ-4/5/6 (feasibility probes KA-1/KA-2
and the per-track gain decision) are out of scope here. KA-1 is already PASSED.

---

## 2. The Decision This Discovery Must Inform

The original OQ-1 and OQ-2 questions are replaced:

| Old question | Why it is no longer the right question |
|---|---|
| OQ-1: Are Takes named like song parts? | Naming is not a proxy for building-block intent. Bricks are reusable regardless of name; default names are expected and valid. |
| OQ-2: Does the developer return cross-session to Takes? | Cannot be observed: the recorder has no combine affordance. Absence of assembly behavior in a tool with no assembly feature is not evidence against the want. |

**The corrected question this discovery must answer:**

> **Will a beginner actually engage the duplicate→rearrange→combine loop in the arrangement
> workspace, and is the UX (DESIGN-002) learnable enough to reach a first combined playback
> without instruction?**

This is primarily the open **usability** risk, plus a residual **desirability** check (Cagan). The
Value risk ("do users actually *want* to recombine building blocks?") is **de-risked by the owner's
stated design conviction — not behaviourally validated for spontaneous demand.** The building-block
design points squarely at Solution A as the *intended* product; that establishes intent, not demand.
So OQ-3 must still *corroborate* want — via an **unprimed pre-task probe** (§4) plus the P2
("edit after hearing") and P4 (engagement) signals — while its main job is to validate that the
specific arrangement UX is approachable for a beginner with no prior DAW experience. **Value is
de-risked, not closed.**

**What is already decided and is NOT questioned here:** the scheduler mechanism (KA-1, PASSED
2026-06-25), the symbolic data model (ADR-0007), and the product direction (Solution A, building-
block recombination). This discovery only informs the UX gate: build as designed vs revise the
arrangement workspace UX before committing to the full build.

### Why Solution B is retired

Solution B (longer single-Take + section markers) is explicitly off-vision. The product is defined
as a building-block recombination tool (modular). A monolithic single-Take model is the opposite
architecture: it fights the core premise rather than enabling it. Solution B may have been a
reasonable alternative in a different product design, but it is not a valid fallback in this one.
It is noted here for historical accuracy, not as a live option.

---

## 3. Existing Evidence (n=3, Corrected Read)

### What the localStorage data tells us

Two stores were inspected (the current store and a legacy store). All three saved Compositions are
catalogued below.

| # | Store | Name | Duration | Note-ons | Preset | Pitch range | Density | Tail gap |
|---|---|---|---|---|---|---|---|---|
| 1 | current | "Composition 1" | 2984 ms | 24 | Organ | 55–78 (G3–F#5) | ~8.0 note/s | 558 ms |
| 2 | old | "Composition 1" | 12271 ms | 3 | Sine | 57–60 (A3–C4) | ~0.24 note/s | — |
| 3 | old | "Composition 2" | 12933 ms | 22 | Organ | 48–72 (C3–C5) | ~1.7 note/s | — |

### Corrected interpretation

**What the original analysis got wrong:** it read short duration, default naming, and varied
presets as evidence of exploratory/throwaway usage. That verdict assumed a Composition was
supposed to be a complete song or named song-part. Given the building-block design, these
attributes are expected: a 3-second building block is a valid brick; default naming is the
expected workflow; using varied presets across sessions is normal when capturing different
musical ideas.

**What the data actually tells us:** these three Compositions are consistent with valid
building-block capture. Their shape (short, default-named, variable preset, variable density)
is compatible with both "exploring the tool" and "creating bricks." The data is **neutral on
the recombination want** — not because the sample is small, but because the right question
cannot be answered by inspecting bricks that have no surface to be assembled on.

**The real reason this evidence cannot answer the open question:** there is a **chicken-and-egg
constraint**. The recorder has no affordance to combine Compositions. The absence of observed
recombination behavior today is not evidence against the want — it is a natural consequence of
building bricks without a LEGO board. OQ-3 exists precisely to introduce the board and observe
what happens.

**Hard limit of this evidence:** n=3, solo developer, no combination affordance available. The
sample cannot be used to conclude anything about engagement with the recombination loop.

---

## 4. The Corrected Open Question: OQ-3 — Recombination UX Desirability

### What OQ-3 asks

> Given 3–5 pre-existing Compositions (building blocks), can a beginner navigate the arrangement
> workspace, assemble a recognisable short song (at least 3 clips across 2 tracks), play it back,
> and make at least one edit after hearing it — **without receiving verbal prompts or instruction**?
> And does the loop feel inviting enough that they want to continue?

### Why a prototype is the right instrument

The current recorder is the wrong tool for this test: it has no combine affordance, so observing
recorder sessions cannot reveal engagement with the recombination loop. The right instrument is a
**cheap, clickable desirability/usability prototype of the arrangement workspace** (Norman/Torres
"prototype to learn"). A static wireframe is insufficient — the drag-drop interaction is central
to learnability. A minimal interactive prototype (Figma interactive prototype or minimal React
PoC, see OQ-3 in PRD-004) is the correct vehicle.

The prototype only needs to answer OQ-3; it does not need to be functionally complete. It must
support:
- Viewing 3–5 pre-loaded Compositions in a panel
- Dragging a Composition onto a track lane
- Playing back the arrangement and hearing the Compositions play together (or simulating audio)
- Moving a clip to a different position

Song-structure templates (Electronic/Rock/Cinematic from PRD-004 US-21) should be included in
the prototype: they are the primary progressive-disclosure mechanism for blank-canvas
disorientation, and their learnability is a direct part of OQ-3.

### OQ-3 — Observable signal definition

The prototype test session has two participants minimum (developer + 1 external beginner if
available — see DEBT-030 on the solo-developer n=1 limitation). Each participant is given:

- **First — an unprimed want-probe, BEFORE any brief or showing the timeline:** "You've recorded a
  few musical ideas — what would you want to do with them next?" Record whether *combining /
  arranging them into a song* surfaces **spontaneously** (a genuine demand signal) or whether they
  reach for something else (export/share, keep playing, one longer take). This is the one demand
  check not contingent on the priming brief — it tests *want*, not just usability.
- Then the prototype opened to a blank arrangement
- A verbal brief: "You have some musical ideas saved. Make a short song from them."
- No further instruction (think-aloud is encouraged; prompting is not).

**Observe:**
1. Does the participant reach first-combined-playback (at least 2 clips playing together)?
2. Do they move or re-position at least one clip after hearing the result?
3. How long does it take to reach first-combined-playback (time-to-first-play)?
4. What is the first point of confusion or hesitation (the Norman "gulf of execution" moment)?
5. Do they make a verbal comment suggesting the loop feels engaging or inviting?
6. **(Want probe)** Did "combine/arrange into a song" surface spontaneously in the unprimed probe,
   before the brief named it? (The clearest signal that the recombination loop is a real demand,
   not just a learnable feature.)

---

## 5. Pre-Committed Success Criteria (Prototype Gate)

This is the explicit, **pre-committed** gate. These thresholds must be committed to the repo
*before* the prototype session runs. Do not adjust them after seeing the data (DEBT-031 proposes
a diff-guard).

### Gate A — Arrangement UX JUSTIFIED (proceed to full Solution A build)

| # | Criterion | Weight | Observable evidence |
|---|---|---|---|
| P1 | Task completion without verbal help | **binding** | The participant reaches first-combined-playback (≥2 clips, ≥2 tracks) without receiving any instruction beyond the initial brief |
| P2 | Edit after first playback | **binding** | The participant moves, trims, or repositions at least one clip after hearing the arrangement — evidence the loop is informing a decision, not just verifying the feature |
| P3 | Time-to-first-combined-playback | **binding** | The participant reaches first-combined-playback in under 5 minutes from opening the prototype |
| P4 | Qualitative engagement signal | corroboration | The participant makes an unprompted comment indicating the loop feels inviting or that they want to continue adding to the arrangement |

If **P1, P2, and P3 are all met** (P4 corroborates): the arrangement UX is learnable; proceed to
the full Solution A build (PRD-004 V1). Assign DEBT-025 as resolved. The PRD-004 work items
(US-1 through US-26) are unblocked. P4 alone, without P1–P3, does not open Gate A.

**The headline signal remains** the same as PRD-004's: an observed "moved a clip after hearing
it" moment (P2). That is the difference between "the arrangement plays back" and "the arrangement
shapes a real composition decision."

### Gate B — UX Revision Required (revise DESIGN-002 before building)

If P1 OR P3 is not met (participant could not complete the task without help, or the time to
first-play exceeds 5 minutes):

| # | Finding | Implication |
|---|---|---|
| B1 | Participant blocked at placement (could not drag or did not discover the panel) | Track/panel affordance is not discoverable; revise DESIGN-002 and re-test before committing to the build |
| B2 | Participant blocked at playback (found clips but could not start playback) | Transport affordance is not discoverable; revise and re-test |
| B3 | Participant placed clips but did not edit after hearing (P2 not met) | The "move after hearing" loop is not naturally triggered; revisit progressive-disclosure scaffolding |

If Gate B is reached: **do not build the full workspace**. Revise the affected affordance in
DESIGN-002 (a targeted design iteration, not a rebuild), run a second lightweight prototype test
with the revision, and re-evaluate against the same P1–P3 thresholds. Solution B (longer Takes)
remains retired and is not the fallback here; the fallback is a UX revision of Solution A's
workspace, not a retreat to a different architecture.

### Gate C — Extend the Test

If P1 and P3 are met but P2 is not, or if only one participant was available and the result is
genuinely ambiguous:

Run one more prototype session with the P2-specific adjustment (e.g. add an explicit "try moving
a clip to hear the difference" prompt after first playback) and observe whether the loop fires
naturally in the second session. If P2 still does not fire without prompting after the adjustment,
apply the Gate B implication for B3.

### What would shift scope regardless of the gate outcome

- If the primary point of confusion in the prototype (the first hesitation moment) consistently
  points to an issue not covered by DESIGN-002 (e.g. the Compositions panel is hidden, the
  timeline ruler is unreadable), address it before re-testing — do not re-run the prototype
  against the same confusing surface.
- If P4 (engagement signal) is strongly negative (participant expresses that the concept itself
  is not appealing, not just that the UX is confusing), escalate to a desirability review before
  proceeding. This is unlikely given the building-block vision, but it is the honest kill
  condition if it occurs.

---

## 6. Story-Based Retrospective Prompts (Torres — Past Behavior, Not Hypotheticals)

These prompts are for a 15-minute structured retrospective conducted after the prototype session.
All prompts ask about what actually happened during the session — never "would you" or "do you
think."

**P-R1 — Warm-up (what actually happened):**
"Walk me through what you just did in the prototype, step by step, from the moment you opened it."

**P-R2 — The first decision:**
"What was the first thing you tried to do? What happened? Was that what you expected?"

**P-R3 — The move moment (core P2 probe):**
"After you played the arrangement the first time — what went through your mind? Did you want to
change anything? What did you do?"
Follow-up: "Was there a moment where you heard something and wanted to move or rearrange it?"

**P-R4 — The confusion moment (UX friction probe):**
"Was there any moment where you weren't sure what to do, or where something didn't work the way
you expected? Describe what happened."

**P-R5 — The invitation question (engagement probe):**
"After this session — if the arrangement workspace were in the real app right now, would you
open it the next time you recorded a few Compositions? What would you use it for?"

**P-R6 — The building-block reality-check:**
"Looking at the Compositions in the panel — did any of them feel like they belonged together?
Did any feel wrong together? What made you decide where to put each one?"

---

## 7. Leading vs Lagging Metrics

PRD-004's headline signal is: **a clip moved after first hearing the arrangement** (evidence the
arrangement loop informs a composition decision, not just verifies the feature).

The following metrics trace the causal path from this discovery to that signal.

### Leading indicators (observable during the prototype session, before any build)

| Metric | Why it is leading | Observed in |
|---|---|---|
| Task completion without help (P1) | If placement is discoverable, the arrangement loop can start; without this nothing downstream fires | Prototype session observation |
| Time-to-first-combined-playback (P3) | Time to entry is the strongest predictor of whether beginners will reach the loop in real use | Prototype session timing |
| Edit after first playback (P2) | The "moved after hearing" moment is the leading signal of the composition loop engaging — not just playback verification | Prototype session observation |
| First confusion / hesitation point | Pinpoints the specific affordance to fix if Gate B is reached; prevents re-building instead of re-designing | Session observation + retrospective |
| Unprompted engagement comment (P4) | Intrinsic motivation to continue is the predictor of cross-session sustained use | Retrospective P-R5 |

### Lagging indicators (only observable after Solution A is built and in use)

| Metric | PRD-004 signal it maps to | How to observe |
|---|---|---|
| Clips placed per arrangement session | Multi-track assembly is reached (PRD-004 table: ≥3 clips, ≥2 tracks) | Inspect localStorage `musicware.arrangements.v1` |
| Song played through without restart | Song plays through (PRD-004 table) | Developer log |
| Clip moved after first playback | **Headline signal** — arrangement loop informs composition | Developer log or take-note during use |
| Arrangement opened in a later session | Recordings are used across sessions (PRD-004 table) | localStorage timestamp inspection |
| Section label applied | Song-structure markers are load-bearing (PRD-004 table) | localStorage inspection |

The leading indicators in this discovery are the earliest predictors of whether the lagging
indicators will ever fire. If the prototype test shows the loop cannot be entered without
instruction (P1/P3 fail), the lagging indicators will never become meaningful regardless of
build quality.

---

## 8. Cadence, Duration, and Kill / Continue Criterion

### Recommended cadence

One prototype test session. The prototype must be built or assembled before the session runs.
OQ-3 in PRD-004 specifies a Figma interactive prototype or minimal React PoC (not a static
wireframe — drag-drop interaction is load-bearing). Build time for the prototype is the
primary scheduling variable.

- **Prototype build (pre-session):** construct the arrangement workspace prototype per DESIGN-002's
  Tier 1 progressive-disclosure model. Pre-load 4–5 Compositions (representative bricks: one
  short dense phrase, one sparse melody, one drum groove, one long sustained note). Include the
  song-structure template picker (at minimum the Electronic template).
- **Session (60–90 minutes):** brief the participant, observe task attempt (no instruction), run
  the think-aloud, fill in P1/P2/P3 observations in real time.
- **Retrospective (15 minutes, immediately after):** run prompts P-R1 through P-R6.

**This instrument supersedes the prior "observe 2 recorder sessions" instrument.** The recorder
sessions cannot answer OQ-3 because the recorder has no recombination affordance. Any data
collected from recorder-only sessions should be treated as background context, not as gate
evidence.

### Kill criterion (stop prototype iteration — build lean to learn)

If after two prototype test sessions (one revision cycle) P1 and P3 remain unmet and the
confusion points are structural (not surface-level), consider: **build a minimal walking skeleton
of the arrangement workspace** (place 1 clip, play it back — US-11 + US-22 only) and observe
behavior in the real app. This is the "build lean to learn" fallback when the prototype test
cannot converge. It is not the preferred path (it costs build time and risks scope creep), but
it is the honest option if the prototype abstraction is causing the confusion rather than the
design itself.

> **Hard stop on this fallback (no silent slide into "just build it").** The walking-skeleton path
> may begin only when **(a)** P1∧P3 failure is judged *structural* across both prototype sessions,
> **AND (b)** an explicit sign-off is recorded *before* any US-11/US-22 code is written. DEBT-031's
> pre-registration diff-guard extends to this threshold so it cannot be loosened post-hoc.

### Continue criterion (prototype Gate A met — proceed to full build)

If P1, P2, and P3 are all met in the first prototype session: proceed immediately to the full
Solution A build (PRD-004 V1). The gate is designed to be passed quickly when the UX is
learnable; do not run additional prototype sessions if the evidence is clear.

---

## 9. Limitations and Honest Constraints

**DEBT-030 — solo-developer n=1 bias.** The gate-author is the sole user of the app today. A
prototype test conducted only with the developer is subject to the observer effect and author
bias (they know the intended UX). Every effort should be made to include at least one external
beginner participant (someone who has not seen the product before) in the prototype session.
If only n=1 (developer) is available, record this limitation explicitly at gate evaluation
and raise the qualitative bar: the developer should try to recall first-time confusion moments
rather than evaluating from the designer's perspective.

**A3-style self-reports are corroboration only.** P4 (engagement signal) and the retrospective
responses are self-reports. They strengthen confidence when P1–P3 hold. They never substitute
for the behavioral observations (P1, P2, P3). Torres' prohibition on hypotheticals and
self-report as primary evidence applies here.

**The building-block design is the owner's stated direction — de-risked, not behaviourally validated.**
This discovery does not re-open whether multi-track arrangement is the right direction; that is set
by the owner's design conviction (intent), **not proven demand**. The prototype test de-risks the UX
of that direction AND corroborates want (the §4 unprimed probe + P2/P4); it does not, by itself,
behaviourally validate spontaneous demand — see §2 ("Value is de-risked, not closed"). If the prototype test reveals a fundamental want mismatch (P-R5 retrospective strongly
negative on the concept, not the UX), that is a separate, higher-stakes conversation that should
not be resolved by this plan alone.

---

## 10. Links

| Artifact | Relevance |
|---|---|
| `docs/product/prds/PRD-004-song-arrangement.md` | Source of OQ-3, OST branch, Solution A framing, and the success metrics this discovery feeds |
| `docs/product/design/DESIGN-002-song-arrangement-workspace.md` | The arrangement workspace UX — Tier 1 progressive-disclosure model and template picker that the prototype must implement |
| `docs/CONTEXT.md` | Glossary — Composition (= reusable building block; short/default/incomplete is expected), Recombination workflow, Recording, Arrangement, Song mode, Clip instance, Section marker |
| `docs/architecture/decisions/ADR-0007-song-arrangement-symbolic-timeline.md` | The data model and scheduler design that Gate A would unlock for implementation |
| `.moonozy/state.json` `openDebt.DEBT-025` | The tracked judgment item this discovery resolves |
| `.moonozy/state.json` `notes.ka1Gate` | KA-1 PASSED — feasibility risk retired; this plan covers the remaining Desirability and Usability risks only |
| `.moonozy/state.json` `openDebt.DEBT-030` | Solo-developer n=1 bias — recruit ≥1 external beginner if possible |
| `.moonozy/state.json` `openDebt.DEBT-031` | Pre-registration diff-guard for §5 gate thresholds |

---

## Appendix — Retired Glossary Proposals

The following terms were proposed in the original DISCOVERY-001 and are superseded by the
building-block clarification. They are archived here for traceability.

- **Deliberate part** — (Superseded) Originally defined as a Take recorded with intent to combine
  with other Takes into a multi-section song, distinguished from a self-contained performance.
  This distinction is moot under the building-block model: all Compositions are, by design,
  building blocks; the word "deliberate" is no longer a differentiating attribute. Retired.

- **Cross-session intent** — (Superseded) Originally defined as the behavior of returning in a
  later session to a Take from an earlier session, with intention of building on it. This was
  OQ-2's signal. As a behavioral observation criterion, it is superseded: the recorder cannot
  reveal this intent because no combine affordance exists. The concept survives as a lagging
  indicator (§7: "Arrangement opened in a later session"), but is not a gate condition.

- **Self-contained performance** — (Superseded) Originally defined as a Take complete on its own
  terms, the alternative to a deliberate part. This distinction is moot under the building-block
  model. Retired as a gate-relevant concept.
