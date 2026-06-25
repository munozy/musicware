# Moonozy Music — Shared Data Contract (v1)

> The single I/O vocabulary every `moonozy-*` music agent and skill speaks. This is what makes the set
> **reusable across projects**: an agent never reaches into a host app's internals — it consumes and
> emits these JSON shapes. Any frontend (this Tauri/React app, a web playground, a future native app)
> that can produce a `RecordingSummary[]` and apply an `Op[]` can use the whole agent suite unchanged.

House rule: agents are **advisory and non-destructive**. They never mutate an arrangement. They return
`Suggestion` objects carrying concrete `Op[]`; the **host** validates and applies the ops (human-in-the-loop —
Karpathy's short leash). This keeps the agents pure functions of their inputs and trivially testable.

---

## 1. Source shapes (provided by the host)

These mirror what already exists in musicware (`src/recordings.ts`, `src/synth.ts`). On another project,
map your equivalents onto these shapes at the boundary (an anti-corruption layer, Evans).

```jsonc
// A symbolic event — NOT audio. Mirrors src/synth.ts SynthEvent + a timestamp.
"RecEvent": { "kind": "on" | "off" | "preset", "note": 60, "index": 0, "t": 1234 } // t = ms from take start

// A saved keyboard composition. Mirrors src/recordings.ts Recording. The unit a clip references.
"Recording": {
  "id": "string", "name": "string", "createdAt": 0, "durationMs": 0, "events": [ /* RecEvent */ ]
}
```

### RecordingSummary — the analysis-friendly digest the host derives from a Recording

Agents prefer this compact digest over the raw event stream (cheaper context, stable across versions):

```jsonc
"RecordingSummary": {
  "id": "string",
  "name": "string",
  "durationMs": 0,
  "presetIndex": 0,                      // timbre stamped at t=0 (0 Sine 1 Organ 2 Piano 3 Bells 4 Drums 5 Theremin)
  "noteCount": 0,
  "pitchRange": { "minNote": 48, "maxNote": 72 },   // null for the Drums preset
  "densityNps": 0.0,                     // note-ons per second — a proxy for energy/busyness
  "estimatedKey": "C major",             // heuristic, may be null
  "estimatedTempoBpm": 120,              // heuristic from inter-onset intervals, may be null
  "suggestedRole": "melody"              // melody | chords | bass | pad | lead | drums | unknown
}
```

---

## 2. Arrangement shapes (the song being built)

Authoritative definitions live in [ADR-0007](../../architecture/decisions/ADR-0007-song-arrangement-symbolic-timeline.md).
Fields marked **(V1)** are live in version 1; the rest are present-but-inert, reserved for the phased DSP-graph
growth so persisted JSON is forward-compatible.

```jsonc
"ClipInstance": {                        // an INSTANCE of a Recording placed in time — never copies its events
  "id": "string",
  "recordingId": "string",               // (V1) references a Recording by id
  "startMs": 0,                          // (V1) position on the timeline
  "transpose": 0,                        // (V1) semitones, applied to note events at schedule time
  "loopCount": 1,                        // (V1) how many times the clip repeats back-to-back
  "trimStartMs": null, "trimEndMs": null,// (V1) optional in/out trim within the recording
  "gainDb": null,                        // (later) per-clip level
  "fades": null                          // (later) { "inMs": 0, "outMs": 0 }
}

"Track": {
  "id": "string",
  "name": "string",                      // (V1)
  "color": "#7c5cff",                    // (V1)
  "presetIndex": 0,                      // (V1, advisory) the instrument this track maps to
  "clips": [ /* ClipInstance */ ],       // (V1)
  "muted": false, "soloed": false,       // (V1)
  "gainDb": null, "pan": null,           // (later) needs the per-track mix graph (V2b)
  "inserts": [], "automation": [],       // (later) effects + automation lanes (V2c / V3)
  "groupId": null                        // (later) track grouping
}

"Section": {                             // a named span over the ruler — a visual guide, not a playback region
  "id": "string", "name": "Chorus", "startMs": 0, "endMs": 0, "color": "#3ad1c8"
}

"Arrangement": {
  "id": "string", "name": "string", "createdAt": 0,
  "tempoBpm": 120, "timeSig": [4, 4],    // (V1) governs the bar/beat grid + quantize
  "tracks": [ /* Track */ ],             // (V1)
  "sections": [ /* Section */ ],         // (V1)
  "buses": []                            // (later) effect buses / sends
}
```

---

## 3. The Suggestion envelope (what every agent RETURNS)

```jsonc
"Suggestion": {
  "kind": "structure" | "arrangement" | "transition" | "automation" | "mix" | "guidance" | "analysis",
  "summary": "string",        // ONE plain-language sentence a beginner understands (no jargon)
  "rationale": "string",      // the musical 'why' — short, may use a term IF immediately explained
  "confidence": 0.0,          // 0..1 — honest; low confidence is fine and must be stated
  "ops": [ /* Op */ ],        // concrete, machine-applyable changes (may be empty for pure advice)
  "tags": ["genre:electronic"]// optional, free-form, for filtering/telemetry
}
```

### Op — the only way an agent proposes a change. The host owns applying these.

```jsonc
{ "op": "createTrack",        "track": { /* partial Track */ } }
{ "op": "renameTrack",        "trackId": "t1", "name": "Bass" }
{ "op": "setTrackColor",      "trackId": "t1", "color": "#ff8a3d" }
{ "op": "setTrackPreset",     "trackId": "t1", "presetIndex": 2 }
{ "op": "muteTrack",          "trackId": "t1", "muted": true }
{ "op": "soloTrack",          "trackId": "t1", "soloed": true }
{ "op": "placeClip",          "trackId": "t1", "clip": { /* ClipInstance */ } }
{ "op": "moveClip",           "clipId": "c1", "startMs": 8000 }
{ "op": "loopClip",           "clipId": "c1", "loopCount": 4 }
{ "op": "transposeClip",      "clipId": "c1", "transpose": -12 }
{ "op": "trimClip",           "clipId": "c1", "trimStartMs": 0, "trimEndMs": 4000 }
{ "op": "addSection",         "section": { /* Section */ } }
{ "op": "addFade",            "clipId": "c1", "type": "in" | "out", "ms": 1000 }        // later
{ "op": "addAutomationPoint", "trackId": "t1", "param": "volume", "tMs": 0, "value": 0.0 } // later
{ "op": "setTrackGainDb",     "trackId": "t1", "gainDb": -3.0 }                          // later
{ "op": "setTrackPan",        "trackId": "t1", "pan": -0.3 }                             // later
```

**Param namespace** for automation (extensible — "any future parameter" maps here):
`volume`, `pan`, `filterCutoff`, `reverbAmount`, `delayAmount`, `<future>`.

---

## 4. Validation rules (every agent + the host enforce these)

1. **Reference integrity** — every `recordingId` in an op resolves to a known Recording; every `trackId`/`clipId`
   resolves to an existing entity (or is created earlier in the same `ops[]`).
2. **Time is non-negative** — `startMs`, `endMs`, `*Ms ≥ 0`; `endMs > startMs`; `trimEndMs > trimStartMs`.
3. **No silent overwrite** — an op never deletes user content; destructive intent (split/merge) is expressed as
   explicit add/remove pairs the host can preview and undo.
4. **V1 boundary** — agents MUST NOT emit `later` ops (pan, EQ, sends, automation, fades) when the host declares
   `capabilities: ["v1"]`. If the musical advice needs them, say so in `summary` and route it to `guidance`
   instead of emitting an inapplicable op. (See ADR-0007: no per-track mix/DSP graph in V1.)
5. **Beginner safety** — every `summary` is jargon-free; any term in `rationale` is explained in the same breath.
6. **Confidence honesty** — speculative suggestions carry `confidence < 0.6` and say why.

---

## 5. Capability negotiation

The host passes a `capabilities` array so the same agent adapts to a V1 app or a future full-mixer app:

```jsonc
"capabilities": ["v1"]                                   // symbolic timeline only — engine has no DSP graph
"capabilities": ["v1", "per-track-gain", "fades"]        // V2b reached
"capabilities": ["v1", "per-track-gain", "fades", "eq", "reverb", "sends", "automation"] // V2c+/V3
```

Agents read `capabilities`, emit only ops the host can apply, and downgrade everything else to `guidance`.
This is the single mechanism that lets the suite grow with the engine without rewriting any agent.
