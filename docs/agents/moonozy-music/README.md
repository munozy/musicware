# 🎛️ Moonozy Music Agents & Skills

A reusable, multi-agent toolkit that turns a folder of short keyboard compositions into a **complete,
arranged song** — designed for people with little or no music-production experience, while leaving a clean
growth path to professional power. Built as the **foundation** for musicware's Song Arrangement feature
([PRD-004](../../product/prds/PRD-004-song-arrangement.md)), but deliberately **project-agnostic**: the agents
speak a [shared JSON contract](CONTRACT.md), not musicware internals, so they drop into any future
music-production project unchanged.

## Why agents at all?

Arranging a song is a chain of distinct judgments — *what have I got? → what shape should the song be? → where
do the pieces go? → how do the seams sound? → is the balance right? → say all of that in plain English.* Each
link is a different skill. One monolithic prompt does all of them badly; **seven focused specialists**, each
with one job and a shared vocabulary, do them well and stay individually testable and reusable. (Karpathy:
no theatrical sprawl — every agent here maps to exactly one stage of the brief's requested workflow, no more.)

## The set

### Agents (`.claude/agents/moonozy-*.md`) — one per pipeline stage

| Agent | Stage | Model | One-liner |
|---|---|---|---|
| [`moonozy-music-director`](../../../.claude/agents/moonozy-music-director.md) | orchestrate | opus | Plans the pipeline, routes the specialists, merges their suggestions into one coherent plan. |
| [`moonozy-composition-analyst`](../../../.claude/agents/moonozy-composition-analyst.md) | 1 analyze | sonnet | Reads each Recording → key, tempo, density, pitch range, suggested musical role. |
| [`moonozy-song-architect`](../../../.claude/agents/moonozy-song-architect.md) | 2 structure | opus | Proposes the song's sections (Intro/Drop/Chorus…) and bar lengths for a genre. |
| [`moonozy-arrangement-engineer`](../../../.claude/agents/moonozy-arrangement-engineer.md) | 3 arrange | sonnet | Places clips onto tracks at the right times to fill the proposed structure. |
| [`moonozy-transition-designer`](../../../.claude/agents/moonozy-transition-designer.md) | 4 transitions | sonnet | Suggests fades, automation and effect moves at section seams. |
| [`moonozy-mixing-advisor`](../../../.claude/agents/moonozy-mixing-advisor.md) | 5 mix | sonnet | Reviews levels, panning, density clashes and headroom; flags problems. |
| [`moonozy-beginner-guide`](../../../.claude/agents/moonozy-beginner-guide.md) | 6 explain | sonnet | Rewrites every recommendation as warm, jargon-free, encouraging guidance. |

### Skills (`.claude/skills/moonozy-*/SKILL.md`) — callable independently

| Skill | Does |
|---|---|
| `moonozy-analyze-song-structure` | Summarise a set of Recordings + detect existing structure/energy arc. |
| `moonozy-generate-arrangement` | Produce a full track/clip placement plan from summaries + a structure. |
| `moonozy-suggest-transition` | Propose the transition between two adjacent sections. |
| `moonozy-detect-loop-opportunities` | Find clips that loop cleanly and recommend loop counts. |
| `moonozy-create-fade-automation` | Generate fade-in/out and volume-automation ops (capability-gated). |
| `moonozy-build-electronic-song` | One-shot Electronic template (Intro/Build/Drop/Breakdown/Outro). |
| `moonozy-build-rock-song` | One-shot Rock template (Intro/Verse/Chorus/Bridge/Solo/Outro). |
| `moonozy-build-cinematic-song` | One-shot Cinematic template (Intro/Tension/Climax/Resolution). |
| `moonozy-mix-review` | Standalone mix critique of an existing Arrangement. |
| `moonozy-beginner-guidance` | Translate any Suggestion/term into plain language with a "why". |

> Agents *embody a role* across a conversation; skills are *one callable procedure*. An agent typically uses
> one or more skills to do its job (named in each agent's body — see the skills section of each file).

## The shared contract

Everything above reads and writes the shapes in **[CONTRACT.md](CONTRACT.md)**: `RecordingSummary` in,
`Suggestion { ops: Op[] }` out. Agents are **advisory and non-destructive** — they never mutate a song; they
return ops the host validates and applies, with the user in the loop. A `capabilities` array lets the same
agent serve a V1 symbolic-timeline app *and* a future full-mixer app without a rewrite.

## Install / reuse in another project

These are standard Claude Code project agents and skills — no plugin packaging required:

```
.claude/agents/moonozy-*.md          # 7 agent definitions
.claude/skills/moonozy-*/SKILL.md    # 10 skill definitions
docs/agents/moonozy-music/           # this documentation + the contract
```

Copy `.claude/agents/moonozy-*` and `.claude/skills/moonozy-*` into any repo; they are auto-discovered by
Claude Code and consumable by the Moonozy plugin in Claude Desktop. The only adapter you write per project is
the boundary that maps your app's data onto `RecordingSummary` / `Arrangement` and applies `Op[]` — see
[CONTRACT.md §1](CONTRACT.md).

## Orchestration & examples

The end-to-end flow, textual architecture diagrams, example prompts and example outputs live in
**[ORCHESTRATION.md](ORCHESTRATION.md)**.

## Versioning

- **Contract version** is the compatibility anchor: `CONTRACT.md` is **v1**. A breaking change to the shapes
  bumps to v2 and ships a new `CONTRACT.md` section; agents declare the contract version they target in their
  frontmatter `description`. Additive fields (new optional keys, new `Op` kinds, new automation params) are
  **non-breaking** and do not bump the version.
- **Agent/skill versions** follow the repo (git history is the changelog). Each file is independently
  replaceable; because they communicate only through the contract, you can upgrade one agent without touching
  the others.
- **Capability flags** (not versions) gate features that depend on the host engine's maturity (`per-track-gain`,
  `eq`, `reverb`, `automation`…). This is how the suite tracks the engine's phased DSP-graph growth (ADR-0007)
  without version churn.
- **Naming is the namespace**: every agent and skill is prefixed `moonozy-`, so the toolkit never collides with
  a host project's own agents/skills.
