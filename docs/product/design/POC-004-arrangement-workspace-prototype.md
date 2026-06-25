# POC-004 — Arrangement Workspace Prototype (Brick Stack)

> Owner: developer (solo conductor). Date: 2026-06-25. Status: `exploring`.
> Prototype: `prototypes/spike-4-arrangement-workspace/index.html`
> Norman/Nielsen/Torres: prototype to **learn** — throwaway by design.
> Graduating requires a linked PRD *and* ADR; never copy PoC code into production source.

---

## Open question being tested

**OQ-3 (DISCOVERY-001):** Will a beginner with zero DAW experience engage the
duplicate→rearrange→combine loop, and is the arrangement workspace UX learnable enough
to reach first combined playback without instruction?

Specifically: the "combine" concept — that two clips on different rows at the same time
column will sound simultaneously — is the single hardest idea to convey to a zero-DAW user.
The open question is whether the geometric stacking metaphor (same column, different row =
play together) plus a live gold "these will play together" overlap cue makes that idea
near-unavoidable, or whether it still requires explanation.

---

## What the prototype tests

1. **Discoverability of drag-to-place:** do beginners pick up a brick card and drag it to
   a lane without instruction, or do they hesitate? (P1 / Gulf of Execution)

2. **Combine affordance comprehension:** does the brick-stack geometry (stacking = combining)
   make cross-lane overlap the default outcome without a "combine" verb? (P1 core risk)

3. **Playback loop engagement:** after hearing the arrangement, does the beginner want to
   move or rearrange a clip? (P2 — the "moved after hearing" headline signal)

4. **Time-to-first-combined-playback:** can the beginner reach first combined playback in
   under 5 minutes? (P3 — the practicality threshold)

5. **Unprimed demand signal:** does "combine/arrange into a song" surface spontaneously
   before the brief? (Want-probe — the residual Value risk check)

---

## Approach: Brick Stack

A single full-viewport dark-glass surface with three pre-drawn horizontal lane troughs
and a bottom tray of 5 oversized draggable brick cards. Left-to-right is time;
top-to-bottom is who-plays-together. Vertical stacking IS combining — there is no
separate "combine" verb to learn.

Key reinforcements grafted from the design evaluation:

- **Same-lane overlap is refused** (orange ghost + tooltip), funnelling the beginner
  toward stacking on a fresh lane — the combine path.
- **Live gold overlap cue** shown before drop release: "These will play together."
- **First clip auto-snaps to column 0** so brick #1 can never land off-screen.
- **Post-first-playback nudge** baits P2 without priming before playback.
- **Keyboard placement fallback** (select + 1/2/3) makes first-combined-playback
  reachable without drag, for trackpad-shy or AT users.
- **Playhead driven from audioCtx.currentTime** (sample clock) so the sweep stays
  locked to what is heard.

---

## Falsifiable pass criteria (pre-committed — DISCOVERY-001 §5)

These thresholds are committed before any session runs and must not be adjusted post-hoc.

| # | Criterion | Weight | Pass condition |
|---|-----------|--------|----------------|
| P1 | First combined playback unaided | **binding** | Participant reaches AUDIBLE combined playback (>=2 overlapping bricks actually sounding, audio context running) without verbal help beyond the initial brief — measured at the moment the audio context is confirmed running AND the scheduler has resolved >=2 clips from >=2 different lanes with overlapping time windows, not merely by arranging a combinable layout and pressing play |
| P2 | Edit after first playback | **binding** | Participant moves or repositions at least one clip after hearing the arrangement |
| P3 | Time-to-first-combined-playback | **binding** | P1 reached in under 5 minutes from first interaction |
| P4 | Engagement signal | corroboration | Participant makes an unprompted comment that the loop feels inviting |

**Gate A (all P1+P2+P3 met):** arrangement UX is learnable; unblock PRD-004 Solution A
full build. Assign DEBT-025 resolved.

**Gate B (P1 or P3 not met):** revise DESIGN-002 before building. Do not proceed.

---

## What this PoC graduates to

Nothing directly. This is a throwaway instrument whose sole job is to produce a binary
Gate A / Gate B verdict for DISCOVERY-001. The findings inform the PRD-004 Solution A
build decision; they do not constitute production code.

If Gate A is met:
- → handoff: moonozy-product — fold findings (confirmed combine geometry, first-hesitation
  point, want-probe result) into PRD-004 before implementation begins.
- → handoff: moonozy-architect — the validated Brick Stack geometry (column = second,
  cross-lane overlap = combine) should inform the arrangement data model and scheduler
  design in ADR-0007 revision.

If Gate B is met:
- Revise the specific failing affordance in DESIGN-002 (placement discoverability or
  combine geometry, depending on the first-hesitation point).
- Build a revised prototype (POC-004b) and re-run the session against the same P1/P2/P3
  thresholds.

---

## What is deliberately excluded (Tier-1 cut)

Per DESIGN-002 §4 Tier-1 progressive-disclosure rules, the following are hidden:

- Volume/pan per track
- Loop clip, resize clip
- Split, merge, quantize
- Automation lanes
- **Section templates / song-structure picker** — explicitly descoped.
  OQ-3 includes a sub-question about template learnability ("does a blank canvas or a
  pre-structured template help the beginner reach first combined playback faster?").
  This sub-question is **NOT covered by this prototype run**. The prototype presents a
  blank canvas only. Any template-vs-blank finding would require a separate A/B instrument.
  Record this gap explicitly in session notes when writing up DISCOVERY-001 §5.
- AI assist (sparkle)
- Tempo / BPM input
- Export / "Finish my song"
- Record button

These exclusions are intentional. Testing them simultaneously would confuse the P1/P2/P3
signal. They are not findings — they are scope choices.

---

## Limitations

- Audio is synthesized via Web Audio API (not the real Rust engine). Timbres are
  representative approximations — sufficient for the combine-playback test, not for
  evaluating sound quality.
- Brick durations are fixed (symbolic note data, not real saved Recordings). The P2
  "moved after hearing" signal is still valid because the clip positions are fully
  interactive.
- Solo developer (DEBT-030 n=1 bias). Recruit at least one external beginner participant.
  If only n=1 is available, record this explicitly and raise the qualitative bar.

---

## Status

`exploring` — linkedPRD: PRD-004 · linkedADR: ADR-0007 · Discovery: DISCOVERY-001 OQ-3

## Links

| Artifact | Relevance |
|----------|-----------|
| `docs/product/discovery/DISCOVERY-001-arrangement-value-usability.md` | Source of OQ-3 and the binding P1/P2/P3 gate |
| `docs/product/design/DESIGN-002-song-arrangement-workspace.md` | The workspace UX this prototype de-risks |
| `docs/CONTEXT.md` | Canonical building-block model; Composition = reusable brick |
| `prototypes/spike-4-arrangement-workspace/README.md` | Session script and feature map |
| `prototypes/spike-4-arrangement-workspace/index.html` | The prototype itself |
