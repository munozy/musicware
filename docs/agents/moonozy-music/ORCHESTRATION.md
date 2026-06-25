# Moonozy Music — Orchestration Flow

How the seven agents collaborate to turn loose clips into an arranged song, the textual architecture
diagrams, and worked example prompts + outputs. All payloads use [CONTRACT.md](CONTRACT.md) shapes.

---

## The pipeline (maps 1:1 to the brief's requested workflow)

```
 USER                                                                          HOST APP (musicware)
  │ records clips in the keyboard section                                       owns state + applies ops
  ▼
 Recording[] ──► RecordingSummary[]  (host derives the digest; CONTRACT §1)
                      │
                      ▼
        ┌─────────────────────────── moonozy-music-director (opus) ───────────────────────────┐
        │  Reads the goal (genre, mood, target length, user skill tier) + summaries.           │
        │  Decides which specialists to run and in what order. Merges their Suggestions into    │
        │  ONE ordered, de-conflicted plan. Never mutates — emits Suggestion[] for the host.    │
        └───────────────────────────────────────────────────────────────────────────────────┘
             │ 1            │ 2              │ 3                 │ 4              │ 5            │ 6
             ▼              ▼                ▼                   ▼               ▼              ▼
   composition-analyst  song-architect  arrangement-engineer  transition-    mixing-       beginner-
        (analyze)        (structure)        (arrange)          designer        advisor        guide
             │              │                │                   │               │              │
        RecordingSummary  Section[]      placeClip/loop/      addFade/        mix Suggestion  plain-language
        enrichment +      + energy arc   transpose/createTrack automation ops  (levels, pan,   rewrite of ALL
        suggestedRole     (Suggestion)   ops (Suggestion)      (Suggestion)    headroom)       suggestions
             │              │                │                   │               │              │
             └──────────────┴────────────────┴───────────────────┴───────────────┴──────────────┘
                                                   │
                                                   ▼
                                   director merges → Suggestion[] (ordered, with ops)
                                                   │
                                                   ▼
                                   HOST validates ops (CONTRACT §4) → previews to USER
                                                   │
                                   USER accepts / edits / rejects each suggestion (short leash)
                                                   │
                                                   ▼
                                   HOST applies accepted ops → Arrangement updated → playback
```

### Stage responsibilities

1. **Analyze** (`moonozy-composition-analyst`) — for each Recording, fill/raise confidence on `estimatedKey`,
   `estimatedTempoBpm`, `densityNps`, `pitchRange`, and a `suggestedRole`. Output: enriched `RecordingSummary[]`
   wrapped in an `analysis` Suggestion. *This is step 2 of the brief (composition analysis).*
2. **Structure** (`moonozy-song-architect`) — propose `Section[]` for the chosen genre with bar lengths and an
   energy arc. Output: `structure` Suggestion (mostly `addSection` ops + a target track list). *Step 3.*
3. **Arrange** (`moonozy-arrangement-engineer`) — map summaries onto tracks and place clips to realise the
   structure (which clip plays in which section, looped how many times, transposed to fit). Output:
   `arrangement` Suggestion (`createTrack`/`placeClip`/`loopClip`/`transposeClip` ops). *Step 4.*
4. **Transitions** (`moonozy-transition-designer`) — for each section seam, suggest the move that makes it flow
   (fade, filter sweep, drop-out, riser). Output: `transition` Suggestion (capability-gated ops + guidance).
   *Step 5.*
5. **Mix** (`moonozy-mixing-advisor`) — review balance: too many clips at once, level clashes, panning,
   headroom against the limiter (ADR-0003). Output: `mix` Suggestion (gain/pan ops if capable, else guidance).
   *Step 6.*
6. **Explain** (`moonozy-beginner-guide`) — rewrite every prior `summary`/`rationale` into warm, jargon-free
   language with a one-line "why it helps". Output: `guidance` Suggestion mirroring the plan. *Step 7.*

The director (the conductor) is the seventh agent; steps 1–6 above are the six specialists it routes.

---

## Collaboration patterns

- **Conductor-led, not peer-to-peer.** Specialists do not call each other. The director (or the host's Moonozy
  conductor) sequences them and passes each one's output forward. This keeps every specialist a pure function
  and avoids hidden coupling. *Platform note:* in Claude Code a subagent cannot spawn further subagents, so when
  `moonozy-music-director` runs as a subagent it emits an **orchestration plan** (which agents, in which order,
  with which inputs) and merges results the host feeds back; the top-level host/Moonozy does the actual spawning.
- **Contract-only I/O.** Every hand-off is a `RecordingSummary[]` or a `Suggestion`. No agent depends on
  another's internal reasoning — only its declared output. Swap any agent for a better one without touching
  the rest.
- **Capability negotiation, not assumptions.** The host passes `capabilities`; agents emit only applyable ops
  and downgrade the rest to `guidance` (CONTRACT §5). The same transition-designer serves a V1 app (advice
  only) and a V3 app (real automation ops).
- **Skills as the verbs.** Each agent reaches for one or more skills (`moonozy-generate-arrangement`,
  `moonozy-suggest-transition`, …) — listed in the agent's own body so they work even when run as a team
  teammate (where frontmatter skills are not applied).

---

## Three usage modes

1. **Full auto-arrange** — host runs the director with `goal: { genre, lengthSec }` → one merged plan the user
   reviews. (One click: "Arrange my song".)
2. **Single specialist** — host calls one agent for one job ("just suggest a transition here", "review my mix").
3. **One-shot template skill** — `moonozy-build-electronic-song` runs analyze→structure→arrange internally for
   a genre and returns a ready-to-preview plan, the lowest-friction beginner entry point.

---

## Worked example A — "Make a song from my 5 clips" (full auto-arrange)

**Host → `moonozy-music-director`:**
```json
{
  "goal": { "genre": "electronic", "lengthSec": 90, "skillTier": "beginner" },
  "capabilities": ["v1"],
  "summaries": [
    { "id": "r1", "name": "Pad chords", "durationMs": 8000, "presetIndex": 1, "noteCount": 12,
      "pitchRange": {"minNote":48,"maxNote":67}, "densityNps": 1.5, "estimatedKey": "A minor",
      "estimatedTempoBpm": 120, "suggestedRole": "chords" },
    { "id": "r2", "name": "Bass line", "durationMs": 4000, "presetIndex": 2, "noteCount": 8,
      "pitchRange": {"minNote":36,"maxNote":48}, "densityNps": 2.0, "suggestedRole": "bass" },
    { "id": "r3", "name": "Beat", "durationMs": 4000, "presetIndex": 4, "noteCount": 16,
      "pitchRange": null, "densityNps": 4.0, "suggestedRole": "drums" },
    { "id": "r4", "name": "Lead hook", "durationMs": 8000, "presetIndex": 5, "noteCount": 20,
      "pitchRange": {"minNote":60,"maxNote":79}, "densityNps": 2.5, "suggestedRole": "lead" },
    { "id": "r5", "name": "Riser", "durationMs": 4000, "presetIndex": 0, "noteCount": 6,
      "pitchRange": {"minNote":72,"maxNote":84}, "densityNps": 1.5, "suggestedRole": "melody" }
  ]
}
```

**`moonozy-music-director` → host (abridged merged output):**
```json
[
  { "kind": "structure", "summary": "I laid out a classic dance shape: a gentle intro, a build, a big drop, a breather, then an outro.",
    "confidence": 0.8, "ops": [
      { "op": "addSection", "section": { "id": "s1", "name": "Intro",     "startMs": 0,     "endMs": 16000, "color": "#5b8def" } },
      { "op": "addSection", "section": { "id": "s2", "name": "Build-up",  "startMs": 16000, "endMs": 32000, "color": "#f5a623" } },
      { "op": "addSection", "section": { "id": "s3", "name": "Drop",      "startMs": 32000, "endMs": 64000, "color": "#e8456b" } },
      { "op": "addSection", "section": { "id": "s4", "name": "Breakdown", "startMs": 64000, "endMs": 80000, "color": "#7c5cff" } },
      { "op": "addSection", "section": { "id": "s5", "name": "Outro",     "startMs": 80000, "endMs": 90000, "color": "#3ad1c8" } }
    ] },
  { "kind": "arrangement", "summary": "Pads carry the intro; bass + beat enter for the build; everything plus the lead hits in the drop.",
    "confidence": 0.75, "ops": [
      { "op": "createTrack", "track": { "id": "tk-pad",  "name": "Pads",  "color": "#7c5cff", "presetIndex": 1 } },
      { "op": "createTrack", "track": { "id": "tk-bass", "name": "Bass",  "color": "#5b8def", "presetIndex": 2 } },
      { "op": "createTrack", "track": { "id": "tk-drum", "name": "Beat",  "color": "#e8456b", "presetIndex": 4 } },
      { "op": "createTrack", "track": { "id": "tk-lead", "name": "Lead",  "color": "#f5a623", "presetIndex": 5 } },
      { "op": "placeClip", "trackId": "tk-pad",  "clip": { "id": "c1", "recordingId": "r1", "startMs": 0,     "loopCount": 2, "transpose": 0 } },
      { "op": "placeClip", "trackId": "tk-drum", "clip": { "id": "c2", "recordingId": "r3", "startMs": 16000, "loopCount": 4, "transpose": 0 } },
      { "op": "placeClip", "trackId": "tk-bass", "clip": { "id": "c3", "recordingId": "r2", "startMs": 16000, "loopCount": 4, "transpose": 0 } },
      { "op": "placeClip", "trackId": "tk-lead", "clip": { "id": "c4", "recordingId": "r4", "startMs": 32000, "loopCount": 4, "transpose": 0 } }
    ] },
  { "kind": "transition", "summary": "Right before the drop, let the riser swell so the big moment lands harder.",
    "confidence": 0.7, "ops": [ { "op": "placeClip", "trackId": "tk-lead", "clip": { "id": "c5", "recordingId": "r5", "startMs": 28000, "loopCount": 1, "transpose": 0 } } ],
    "tags": ["needs:fades"] },
  { "kind": "mix", "summary": "In the drop you have four parts at once — keep the pad quieter so the lead sings. (I can't change volumes yet, so just lower the Pads track by ear.)",
    "confidence": 0.6, "ops": [] },
  { "kind": "guidance", "summary": "Here's your song in plain words: it starts soft, grows, explodes, takes a breath, then fades out. Press play and move any clip you like — nothing here is permanent.",
    "confidence": 0.9, "ops": [] }
]
```

The host previews these as five accept/edit/reject cards. Note the **mix** and **fade** advice degrades to
plain guidance because `capabilities: ["v1"]` — no per-track gain or fades exist yet (ADR-0007, CONTRACT §4–5).

---

## Worked example B — single specialist ("suggest a transition")

**Host → `moonozy-transition-designer`:**
```json
{ "capabilities": ["v1"], "from": { "name": "Build-up", "endMs": 32000 },
  "to": { "name": "Drop", "startMs": 32000 }, "tempoBpm": 120 }
```
**→**
```json
{ "kind": "transition", "confidence": 0.7,
  "summary": "Cut everything for a split second just before the drop — the silence makes the drop hit harder.",
  "rationale": "A short 'silence before the drop' is the most reliable way to add impact in dance music.",
  "ops": [], "tags": ["technique:pre-drop-silence", "needs:automation"] }
```

---

## Diagram — where the agents sit relative to the app (C4-ish, container level)

```
┌──────────────────────────── musicware (Tauri desktop app) ────────────────────────────┐
│  React UI ── Song mode (timeline) ──┐                                                   │
│                                     │ derives RecordingSummary[] / holds Arrangement    │
│  src/arrangement.ts (scheduler) ────┤ applies accepted Op[]                              │
│                                     ▼                                                    │
│                         ┌─────────── AI Assist boundary ───────────┐                     │
│                         │  passes summaries + goal + capabilities   │                     │
│                         └───────────────────┬───────────────────────┘                    │
└─────────────────────────────────────────────┼────────────────────────────────────────────┘
                                               │ (Claude Desktop / Moonozy plugin)
                                               ▼
                            moonozy-music-director ──► 6 specialists (this toolkit)
                                               │
                                               ▼  Suggestion[] (CONTRACT.md)
                                        back to the UI as review cards
```

The audio engine (Rust real-time thread) is untouched by any of this — agents operate purely on the symbolic
arrangement, exactly as replay does today (ADR-0001/0002).
