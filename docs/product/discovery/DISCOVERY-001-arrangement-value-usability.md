# DISCOVERY-001 — Arrangement Value & Usability
## De-risking PRD-004 OQ-1 / OQ-2 Before the Song-Mode Build

> Owner: developer (solo conductor). Date: 2026-06-25. Status: **Active**.
> Resolves: DEBT-025 (OQ-1/OQ-2 judgment gate, PRD-004).
> Decision this feeds: Solution A (full multi-track Song workspace) vs Solution B (longer Takes +
> section markers in the existing recorder) vs a hybrid path.
> Style: Teresa Torres continuous-discovery; Cagan 4-risks framing.

---

## 1. Positioning on the Opportunity Solution Tree

PRD-004's OST branch:

```
Outcome: developer assembles a complete multi-section song from saved Recordings
  └─ Opportunity: Recordings are isolated islands — no way to arrange fragments in time
        ├─ Solution A — symbolic multi-track arrangement timeline (PRD-004 V1)
        │    Experiment: OQ-1 (do you think in "verse + chorus"?) and OQ-2 (do you return
        │    across sessions to assemble?) → this discovery plan
        ├─ Solution B — longer single-Take + in-Take section markers
        │    Experiment: same OQ-1/OQ-2 (would one longer Take suffice?)
        └─ Solution C — AI-generated arrangement (deferred; US-26 stub is the vehicle)
```

This plan operationalizes OQ-1 and OQ-2 only. OQ-3 (timeline UX PoC) and OQ-4/5/6 (feasibility
probes KA-1/KA-2 and the per-track gain decision) are out of scope here. KA-1 is already PASSED.

---

## 2. The Decision This Discovery Must Inform

| Question | What we need to know | Why it matters |
|---|---|---|
| OQ-1 | Are the developer's saved Takes *parts of a planned larger song* (verse groove, chorus melody, bridge riff), or *self-contained performances* (one complete improvisation per Take)? | If self-contained: Solution B (longer Takes + markers) may fully satisfy the need at a fraction of the build cost. If deliberate parts: Solution A is the correct investment. |
| OQ-2 | Does the developer actually return across sessions to build on saved Takes (sustained compositional intent), or does each session start fresh and treat previous Takes as disposable? | If one-and-done: the arrangement workspace is solving for a workflow that does not yet exist; grow the recording habit first. If cross-session: the assembly loop (PRD-004 headline) is real, and Solution A is justified. |

**What is already decided and is NOT questioned here:** the scheduler mechanism (KA-1, PASSED
2026-06-25) and the symbolic data model (ADR-0007). This discovery only informs the scope decision:
build the full workspace now or deliver a cheaper intermediate first.

---

## 3. Existing Evidence (n=3, Exploratory) — Honest Assessment

### What the localStorage data tells us

Two stores were inspected (the current store and a legacy store). All three saved Takes are
catalogued below.

| # | Store | Name | Duration | Note-ons | Preset | Pitch range | Density | Tail gap |
|---|---|---|---|---|---|---|---|---|
| 1 | current | "Composition 1" | 2984 ms | 24 | Organ | 55–78 (G3–F#5) | ~8.0 note/s | 558 ms |
| 2 | old | "Composition 1" | 12271 ms | 3 | Sine | 57–60 (A3–C4) | ~0.24 note/s | — |
| 3 | old | "Composition 2" | 12933 ms | 22 | Organ | 48–72 (C3–C5) | ~1.7 note/s | — |

### What this evidence tells us — and what it does not

Signals pointing toward "exploratory/test":

- All three Takes carry the system-generated default name ("Composition N"). No Take was renamed to
  suggest intentional authorship (e.g. "Verse groove," "Bass intro," "Drop fill").
- All three are short: the longest is 13 seconds. A deliberate multi-section song would require
  Takes that function as 4-to-16-bar phrases at a chosen BPM — at 120 BPM a 4-bar phrase is ~8 s;
  none of these reads as a finished phrase at a defined tempo.
- Two different presets are in use (Sine, Organ), which is consistent with testing the instrument
  rather than composing with it.

Signals that are inconclusive:

- Take 3 ("Composition 2") has a wide pitch range (C3–C5, 2 octaves) and moderate density at ~1.7
  note/s. This is compatible with melodic intent. It is also compatible with a scale run.
- The Organ preset at dense velocity (Take 1, ~8/s) is plausible as an improvised phrase or as a
  stress test of the recorder.

**Verdict: inconclusive on OQ-1; weakly suggesting "self-contained exploratory" rather than
"deliberate song part."** The evidence does not rule out Solution A — it simply shows the recording
habit is not yet generating the kind of material that would make Solution A obviously needed. That
is precisely the gap this discovery plan is designed to fill.

**Hard limit of this evidence:** n=3, no naming signal, no cross-session intent signal. The sample
is too small and too uniform to conclude anything about OQ-2 (cross-session sustained intent).

---

## 4. Making OQ-1 and OQ-2 Observable

### OQ-1 — Observable signal definition

**Threshold:** In the observation window, at least 2 of the N recorded Takes are given a
role-specific name (not the default "Composition N") AND the naming suggests part-of-a-song intent
(e.g. "bass loop," "verse melody," "drum fill," "bridge riff" — any name that encodes a structural
role rather than a sequence number).

Rationale: renaming is a low-friction signal of intentionality. If the developer is composing
deliberate song parts, they will name them. If they are exploring, they will leave the default.
This is a behavioral indicator, not a self-report.

**Supporting signal:** Any Take whose duration is consistent with a 2-bar, 4-bar, or 8-bar phrase
at the session's informal tempo (even if no tempo is set: if two Takes have similar rhythmic density
and could loop together, that is a part-of-a-song signal).

### OQ-2 — Observable signal definition

**Threshold:** In at least 1 session after Session 1, the developer opens the app and plays back
(replays) at least one Take that was recorded in a PRIOR session — and then records a NEW Take
while that prior Take is mentally in play (e.g. they say "I want something that goes with that").

Rationale: returning to prior work and using it as a reference is the minimal behavioral signal
that cross-session compositional intent exists. The current replay feature makes this directly
observable.

---

## 5. Usage-Log Rubric (Per Session)

The AI cannot observe sessions. The developer runs this log. It takes under 2 minutes per session
to fill in.

### Log one entry per session, immediately after the session ends

```
SESSION LOG — [date] [session number: 1 or 2]

1. Session goal (one sentence, before you started):
   e.g. "Explore drums" / "Record a bass line for a song I have in my head" / "No plan"

2. Takes recorded this session (list each):
   - Name given: [default "Composition N" or a custom name]
   - Preset used: [Sine / Organ / Piano / Drums / Theremin]
   - Approximate duration: [seconds]
   - Intent: [test/explore | complete performance | deliberate part of a larger song]
   - If "deliberate part": what part? [verse / chorus / bridge / bass / lead / drums / other]

3. Prior Takes replayed this session (from a previous session):
   - Which ones? [names or "none"]
   - Why did you replay them? [checking something / playing alongside / just listening / n/a]

4. Cross-session intent (yes/no):
   Did you record anything TODAY with the intention of combining it with a Take from a
   PRIOR session? [yes / no / maybe]
   If yes: describe the intended combination in one sentence.

5. Frustration / gap moment (open):
   Was there a moment where you wanted to do something the app couldn't do?
   If yes: what were you trying to do?
```

---

## 6. Story-Based Interview Prompts (Torres — Past Behavior, Not Hypotheticals)

These prompts are for a 15-minute structured retrospective the developer conducts with themselves
after Session 2, or with 1–2 beginner test users if available. All prompts ask about what already
happened — never "would you" or "do you think."

**P1 — Most recent recording session (warm-up):**
"Walk me through the last time you sat down with the app with the intention of making something.
What did you actually do, step by step, from the moment you opened it?"

**P2 — Naming and intent:**
"Looking at your saved Takes right now — do you remember why you recorded each one? What were
you trying to capture?"
Follow-up: "Did any of them feel like part of something larger, or were they each complete on
their own?"

**P3 — Cross-session behavior (the core OQ-2 probe):**
"Tell me about a time — with this app or any other music tool — when you came back to something
you recorded in a previous session and used it as a building block for something new."
If none: "Has there been a moment where you WANTED to come back to a previous recording and build
on it, but couldn't — or didn't?"

**P4 — The assembly moment (the core OQ-1 probe):**
"Describe the closest you have come to thinking 'I want to combine these two things I recorded.'
What were those things? Why did you want to combine them? What happened?"

**P5 — The frustration moment (both OQs):**
"What is the one thing the recorder can't do right now that you find yourself wishing for most
often? Describe the last specific time you ran into that wall."

**P6 — The song concept (reality-check):**
"If you imagined a 'finished song' that you made in this app — what does that actually look like
to you? How long, how many different parts, does it have a verse and chorus, or is it more like
one continuous thing?"

---

## 7. Decision Gate — Pass / Fail Thresholds

This is the explicit, **pre-committed** gate. **Pre-register it:** these thresholds are committed to
the repo *before* Session 1 runs, and must be byte-identical at evaluation time — do not adjust them
after seeing the data (DEBT-031 proposes a diff-guard). Evaluate after Session 2 (or earlier if the
evidence is unambiguous).

### Gate A — Solution A JUSTIFIED (build the multi-track workspace)

**A1 AND A2 — the two *behavioral* signals — are the binding condition.** A3 is corroboration only:
it cannot by itself carry the decision, because it is a self-report the gate-author controls (Torres'
prohibition on hypotheticals/self-report). It strengthens confidence when A1+A2 hold; it never
substitutes for them.

| # | Criterion | Weight | Observable evidence |
|---|---|---|---|
| A1 | OQ-1 POSITIVE | **binding** | In the 2-session window, at least 2 Takes are given a role-specific name (not default "Composition N") that encodes structural intent (bass line, verse melody, drum fill, etc.) |
| A2 | OQ-2 POSITIVE | **binding** | In at least 1 session, the developer replays a Take from a prior session AND records a new Take intended to go with it (cross-session compositional intent is live) |
| A3 | Qualitative confirmation | corroboration | In the retrospective, the developer can describe a specific pairing of Takes they want to hear together (P4 prompt), naming what they would be combining and why |

If **A1 and A2 are both met** (A3 corroborates): proceed to Solution A (PRD-004 V1 full build).
Assign DEBT-025 as resolved. The PRD-004 work items (US-1 through US-26) are unblocked. A3 alone,
without A1+A2, does **not** open Gate A.

### Gate B — Solution B PREFERRED (longer Takes + section markers)

If A1 OR A2 is not met:

| # | Criterion | Implication |
|---|---|---|
| B1 | OQ-1 NEGATIVE: all Takes remain default-named self-contained performances | The developer is not yet authoring song parts; the assembly loop does not yet exist in practice |
| B2 | OQ-2 NEGATIVE: no cross-session intent in either session | Recordings are being treated as one-and-done; sustained compositional intent is not present |

If B1 AND B2: recommend Solution B first. Deliver in-recorder section markers (a "mark section here"
button during recording, a section label on the Take card). Defer the full arrangement workspace
to the next discovery cycle after the recording habit matures. This costs 1–2 stories instead of
25+.

### Gate C — Hybrid / Extend the Observation

If A1 is met but A2 is not (or vice versa), or if the evidence is genuinely ambiguous (e.g. one
explicitly named "verse" Take but no cross-session use):

Extend the observation by one session. If after Session 3 the pattern remains mixed, default to
Solution B as the safe intermediate (lower build cost, lower risk, keeps the option open for A).

### What would shift PRD-004 V1 scope regardless of the gate outcome

- If the frustration moment (P5 prompt) points consistently to a want other than arrangement (e.g.
  "I want to export," "I want to share"), Solution B AND A may both be misprioritized — revisit
  PRD-003's OQ-2 (export) before building arrangement.
- If the P6 "finished song" answer describes a single continuous 2–5 minute performance (not a
  multi-section assembly), Solution B is the right model even if A1 is technically met.

---

## 8. Leading vs Lagging Metrics

PRD-004's headline signal is: **a clip moved after first hearing the arrangement** (evidence the
arrangement loop informs a composition decision, not just verifies the feature).

The following metrics trace the causal path from this discovery to that signal.

### Leading indicators (observable during discovery, before any build)

| Metric | Why it is leading | Observed in |
|---|---|---|
| Custom Take name rate | Naming = authorial intent; a necessary (not sufficient) precursor to deliberate arrangement | Session log, item 2 |
| Cross-session replay rate | Returning to prior work = compositional continuity; the OQ-2 signal | Session log, item 3 |
| "Deliberate part" self-label rate | Developer explicitly tags a Take as a structural part of a song | Session log, item 2 intent field |
| Frustration gap mentions (assembly-related) | Unsatisfied demand for an arrangement feature; demand precedes supply | Session log, item 5 + P5 interview |

### Lagging indicators (only observable after Solution A is built and in use)

| Metric | PRD-004 signal it maps to | How to observe |
|---|---|---|
| Clips placed per arrangement session | Multi-track assembly is reached (PRD-004 table: ≥3 clips, ≥2 tracks) | Inspect localStorage `musicware.arrangements.v1` |
| Song played through without restart | Song plays through (PRD-004 table) | Developer log |
| Clip moved after first playback | **Headline signal** — arrangement loop informs composition | Developer log or take-note during use |
| Arrangement opened in a later session | Recordings are used across sessions (PRD-004 table) | localStorage timestamp inspection |
| Section label applied | Song-structure markers are load-bearing (PRD-004 table) | localStorage inspection |

The leading indicators in this discovery are the earliest predictors of whether the lagging
indicators will ever fire. If the leading indicators remain flat (no custom naming, no
cross-session intent), the lagging indicators will never become meaningful regardless of build
quality.

---

## 9. Cadence, Duration, and Kill / Continue Criterion

### Recommended cadence

Two deliberate, goal-directed sessions within a 7-day window.

- Session 1: "Record at least 3 Takes with a specific song in mind." Fill the session log
  immediately after.
- Session 2 (2–5 days later): "Come back and build on what you recorded in Session 1. Try to
  make the Takes fit together." Fill the session log immediately after.
- Retrospective (15 minutes, after Session 2): run prompts P1–P6.

"Deliberate" is the key word. The existing n=3 evidence was generated during exploratory/test
use — it cannot answer OQ-1 or OQ-2 because the conditions for the behaviour were never created.
These two sessions must be intentional composition attempts, not feature exploration.

### What Session 2 uniquely tests (kill-vs-Gate-B boundary)

The kill criterion and Gate B share a negative pattern (all-default-named + no pairing), so be
explicit about what Session 2 adds: **A2 (cross-session intent / OQ-2) can only be observed in
Session 2 by construction** — it requires a *prior* session's Take to return to. Therefore Session 1
can only decide **OQ-1** (A1, the naming signal). Session 1 can *kill* on a hard OQ-1 negative (see
below), but it can never satisfy A2; conversely a Session 1 that shows OQ-1 intent still leaves OQ-2
genuinely open, which is exactly what Session 2 exists to test. Do not read a one-session OQ-1
positive as a Gate-A pass.

### Kill criterion (stop observation early — default to Solution B)

Stop and choose Solution B if, after Session 1:

- Every new Take is still given the default name AND
- The developer cannot describe a single Take that is intended to be heard alongside another Take.

This kills on a hard **OQ-1** negative (no authorial/naming intent at all) — a strong enough signal
that the assembly mindset does not exist yet, making Session 2's OQ-2 test moot. Continuing under
these conditions wastes time rather than reduces uncertainty.

### Continue criterion (proceed to Gate A evaluation)

Continue to Session 2 if Session 1 produces at least one of:

- One custom-named Take with a structural label.
- One moment where the developer explicitly wants to combine two Takes and is frustrated by the
  inability to do so (P5/log item 5 signal).
- One replay of a prior Take during the session.

---

## 10. Links

| Artifact | Relevance |
|---|---|
| `docs/product/prds/PRD-004-song-arrangement.md` | Source of OQ-1, OQ-2, OST branch, Solution A/B framing, and the success metrics this discovery feeds |
| `docs/product/design/DESIGN-002-song-arrangement-workspace.md` | The arranged workspace UX (DESIGN-002's Tier 1 progressive-disclosure model and the template picker are only justified if Gate A is met) |
| `docs/CONTEXT.md` | Glossary — Recording, Take, Arrangement, Song mode, Clip instance, Section marker |
| `docs/architecture/decisions/ADR-0007-song-arrangement-symbolic-timeline.md` | The data model and scheduler design that Gate A would unlock for implementation |
| `.moonozy/state.json` `openDebt.DEBT-025` | The tracked judgment item this discovery resolves |
| `.moonozy/state.json` `notes.ka1Gate` | KA-1 PASSED — feasibility risk retired; this plan covers the remaining Value and Usability risks only |

---

## Appendix — Glossary Proposals (for docs/CONTEXT.md; conductor owns that file)

The following terms arose from this discovery plan and are not currently defined in CONTEXT.md.
Proposed additions for the conductor's consideration:

- **Deliberate part** — A Take recorded with the explicit intent that it will be combined with
  other Takes to form a multi-section song. Distinct from a self-contained performance or an
  exploratory take. The OQ-1 distinction hinges on whether the developer's Takes are deliberate
  parts.
- **Cross-session intent** — The compositional behaviour of returning in a later session to a
  Take recorded in an earlier session, with the intention of building on or combining it. The
  OQ-2 signal. Absent cross-session intent, the arrangement workspace solves a problem that does
  not yet exist in the developer's practice.
- **Self-contained performance** — A Take that is complete on its own terms — a full improvisation
  or a finished musical idea — that was not recorded as part of a larger song plan. The
  alternative to a deliberate part; Solution B's natural unit.
