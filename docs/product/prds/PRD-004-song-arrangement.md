# PRD-004 — Song Arrangement

> Owner: developer (solo). Date: 2026-06-25. Status: **Draft**.
> Scope: a symbolic multi-track arrangement workspace built on top of the composition recorder (PRD-003).
> tracker.mode = local — work items tracked as a checklist below and in `state.openDebt`.
> This is a forward-looking PRD written before implementation. The dominant risk is Feasibility
> (the Rust engine has no mixing graph today). V1 is deliberately constrained to what the engine
> can do today; the pro-effects tier is gated on a future DSP-graph ADR.

---

## Problem & opportunity

PRD-003 gave the developer a composition recorder: record a phrase, play it back, build it
iteratively. The capture-and-revisit loop is now proven. The unresolved gap is *assembly*: the
developer cannot combine several recorded phrases into a complete song. Each Recording (Take) is
an island — it plays alone, from start to finish, and then it is over.

Making music is fundamentally about assembling and rearranging fragments — a verse phrase here,
a drum groove there, a bridge that only appears twice. Without the ability to place fragments on a
shared timeline and hear how they fit together, the DAW cannot serve its stated learning goal
(BC-001): hands-on composition practice that grows toward real music production.

The opportunity is the **song-assembly loop**: take a handful of saved Recordings, lay them on
tracks in time, hear the whole thing play together, move sections around, and iterate until it
sounds like a song. That is the feedback cycle that turns a practice tool into a composition tool.

Why now: the Recording data model (`Recording { id, name, durationMs, events: RecEvent[] }`,
ADR-0002) is already symbolic — a stream of timestamped note/preset events, not audio waveforms.
Placing a Recording on a timeline is therefore a scheduling problem, not a signal-processing
problem. The engine already renders voices correctly; the arrangement layer only needs to feed it
correctly-timed events. The incremental surface is real but tractable.

Why not later: every new Recording saved today is a potential clip in tomorrow's arrangement. The
longer we wait, the more the Recording library grows without a place to use it. Momentum from
v0.1.0 makes now the right moment to scope the next major surface.

---

## Outcomes & success metrics

**One measurable outcome — the developer assembles a complete multi-section song from saved
Recordings and plays it through from start to finish without restarting the app.**

| Signal | Observable pass definition |
|---|---|
| Multi-track assembly is reached | Developer places at least 3 clips across at least 2 tracks and initiates a full song playback |
| Song plays through | A song playback from bar 1 to the end runs without gaps, ordering errors, or stuck notes |
| Arrangement is iterated | Developer moves or removes at least one clip after an initial playback — evidence the loop is informing composition decisions, not just verifying the feature works |
| Recordings are used across sessions | At least one clip placed in the arrangement is a Recording created in a prior session |
| Song-structure markers are used | Developer applies at least one section label (Verse/Chorus/Bridge) to the timeline, signalling that the structural scaffolding is load-bearing for their workflow |

The headline signal is the third one: a clip moved after first hearing the result. That is the
difference between "arrangement plays back" and "arrangement shapes a real composition decision."

---

## The 4 risks (and how each is addressed)

**Value — HIGH.**
The core assumption: the developer actually wants to *arrange* complete songs, not just record
isolated phrases. This is unvalidated. An alternative want is simply longer Recordings (capture
a 3-minute performance in one Take) — which requires no arrangement at all. A second alternative
is export/share (PRD-003 OQ-2), where the value is in distributing the finished piece, not in
visual arrangement. Discovery activity: before building, log two sessions of intentional use with
the PRD-003 recorder: are Recordings named and kept because they are parts of a planned larger
song, or are they self-contained performances? If the developer never thinks in terms of "verse"
and "chorus," the arrangement workspace may serve the wrong problem. See OQ-1 and OQ-2.

**Usability — HIGH.**
A timeline is a paradigm leap for complete beginners. GarageBand's own onboarding research found
that the blank-canvas timeline (infinite grid, no structure cues) is the single biggest drop-off
point for new users. Two concrete risks here:

1. *Spatial disorientation*: where does a 16-bar clip go? What does "bar 1" mean? A beginner with
   no prior DAW experience may find the grid opaque without scaffolding.
2. *Too many controls*: even V1's track controls (mute/solo/volume/color) are a meaningful surface
   for someone who has never mixed before.

Mitigation: song-structure templates (Electronic/Rock/Cinematic) pre-populate the timeline with
named section markers (Intro/Verse/Chorus/Bridge/Outro), giving the blank canvas a shape before
the user places a single clip. This is the central progressive-disclosure mechanism. Additionally,
snap-to-grid and section-snapping eliminate the precision-placement problem. A PoC wireframe
(see OQ-3) should validate that a beginner can place their first clip without reading any docs.

**Feasibility — HIGH (dominant risk). The Rust engine has no mixing graph today.**
This is the single most important constraint in this PRD and must not be papered over.

Today the engine renders ONE global 16-voice pool through a single master volume + limiter
(ADR-0003). There is no per-track signal path, no per-track gain node, no pan, no DSP graph, no
buses. "Per-track volume" as a full audio-routing feature requires the engine to grow a mixing
graph — this is a medium-to-large Rust + audio-architecture effort gated on a new ADR.

V1 sidesteps this constraint by treating the arrangement as a *scheduler*, not a *mixer*:
- Clip events are fed to the existing `emit()` dispatch path on a shared timeline schedule.
- Per-track mute/solo is implemented by suppressing or permitting the event feed for a track —
  no audio-level change, only event gating.
- Per-track "volume" in V1 is a simplified gain: the `set_volume` command already controls a
  global scalar. A per-track coarse gain approximation (one at a time, not summed) is the most
  V1 can honestly claim without a DSP graph. Any architecture that implies simultaneous
  per-track independent gain/pan requires the full mixing graph and belongs in a Later release.

Concrete V1 engine constraints:
- No simultaneous per-track pan (single master path, no stereo routing per track).
- No per-track EQ, reverb, compressor, sends, or buses.
- No crossfades (clip boundaries are hard cuts in the event schedule).
- No automation lanes for volume/pan (global master volume is not per-clip).
- The 16-voice pool is shared across all tracks; dense arrangements may hit the polyphony
  ceiling (voice stealing is the existing mitigation — ADR-0001 / STORY-K3).
- Playback scheduler timing: the existing `setTimeout`-based replay from ADR-0002 works for
  a single clip; a multi-clip arrangement scheduler must coordinate multiple concurrent event
  streams. This is a new TS engineering surface (see KA-1 below).

De-risking activities:
- **KA-1 (scheduler spike) — ✅ PASSED (2026-06-25).** Built as the pure, tested scheduler core
  `src/arrangement.ts` (`flattenArrangement` + `playArrangement`) rather than a throwaway, since
  the design was already decided (ADR-0007) and it is pure-frontend. 22 gate tests prove: overlapping
  clips both sound; a mid-stream Stop releases every held note; no stranded note under loops/trims/
  transpose; dangling clips are skipped. Hardened by a 5-lens adversarial review (2 real bugs fixed:
  dangling-off same-pitch kill, dropped preset stamp). Engine untouched. **The dominant feasibility
  risk is retired at the mechanism level** — the UI build is unblocked on this axis (Value/Usability
  observation OQ-1/OQ-2 / DEBT-025 still owed before the full build).
- **KA-2 (voice-ceiling probe):** With a typical 3-track arrangement (melody + chords + drums),
  measure the peak concurrent voice count. If it regularly exceeds 16 and voice stealing becomes
  perceptible, the polyphony ceiling is a user-visible bug, not an accepted cost.

**Business viability — N/A.**
Personal learning project, no GTM, no revenue. Viability = sustained motivation. The arrangement
workspace serves motivation by making the synth+recorder pair feel like a real DAW. Risk: the
scope is large enough to demotivate if not sliced aggressively into releasable increments. The
V1-vs-Later table below is the primary mitigation.

---

## Users / personas

**The developer.** Solo engineer learning audio DSP and Rust+React desktop architecture; also the
sole user. Has a growing library of saved Recordings from PRD-003 practice sessions. Wants to
hear those phrases together in time, experiment with song structure, and feel the satisfaction
of completing a full arrangement — even a short one. Has little or no prior DAW experience
beyond what they have built themselves. (BC-001, PRD-002, PRD-003.)

---

## Solution narrative (not a spec)

The developer opens the arrangement workspace (accessible from the main studio header — the
designer is choosing its name and visual placement). The first thing they see is a choice:
start from a blank canvas or pick a song-structure template. They choose "Electronic (Intro /
Verse / Drop / Bridge / Outro)." The timeline fills with named section markers at conventional
bar positions — not clips yet, just a skeleton that tells them where things go.

In a panel on the side (or accessible from the existing Compositions panel), their saved
Recordings are listed. They drag "Bass Loop 1" onto a track labelled "Bass" under the Intro
marker. The clip snaps to bar 1. They drag "Synth Lead 3" to the Verse marker on a second
track. A third track gets their drum groove. They press Play on the Transport.

The Intro plays: the bass enters at bar 1. The Verse starts: the synth lead and drums join.
They can hear that the bass loop is too long — it bleeds into the Verse. They trim the right
edge of the bass clip to exactly the Intro boundary. Play again. Better.

They mute the drums, listen to just the melodic layers. Solo the lead to hear it alone. These
controls are in the track header — a coloured sidebar to the left of each row, styled like
GarageBand's compact track strip.

They save the arrangement. Next session they reopen it and add a Chorus.

The arrangement workspace does not ask them to understand signal routing, gain staging, or
busses. Those concepts exist in Later milestones when the engine grows a DSP graph. For now
the power is in the timeline, the section structure, and the ability to hear the parts together.

---

## User stories

### V1 — MVP (Now)

#### Workspace

- [ ] **US-1 — Open the arrangement workspace**
  As a developer, I want to open a dedicated arrangement workspace from the main studio, so
  that I can switch between the keyboard/recorder and the song arrangement without losing either.
  *Acceptance: a navigation control in the studio header (or equivalent) switches the main
  stage between the keyboard view and the arrangement workspace; both views persist their state
  across the switch.*

- [ ] **US-2 — Arrangement persistence**
  As a developer, I want my arrangement (tracks, clip positions, section markers) to persist
  across app restarts, so that I can build a song over multiple sessions.
  *Acceptance: the arrangement is saved to localStorage on every change and reloaded on app
  start; a corrupt or missing arrangement returns an empty arrangement, not a crash.*

#### Tracks

- [ ] **US-3 — Create a track**
  As a developer, I want to add a new track to the arrangement, so that I can organise clips
  by instrument or role.
  *Acceptance: an Add Track button creates a new, empty, named track with a default colour;
  the track appears in the track list and has a corresponding lane on the timeline.*

- [ ] **US-4 — Rename a track**
  As a developer, I want to rename a track, so that I can label it with its role (Bass,
  Lead, Drums).
  *Acceptance: clicking the track name opens an inline edit; Enter commits, Escape cancels;
  empty draft restores the previous name.*

- [ ] **US-5 — Colour a track**
  As a developer, I want to assign a colour to a track, so that I can tell tracks apart at
  a glance on the timeline.
  *Acceptance: a small colour picker (6–8 preset swatches) is accessible from the track
  header; the chosen colour is applied to the track header and to all clips on that track.*

- [ ] **US-6 — Reorder tracks**
  As a developer, I want to drag tracks into a different vertical order, so that I can put
  the most important parts at the top.
  *Acceptance: a drag handle on the track header allows vertical reordering; the new order
  persists.*

- [ ] **US-7 — Mute a track**
  As a developer, I want to mute a track, so that I can silence it during playback without
  deleting its clips.
  *Acceptance: toggling Mute on a track suppresses all event dispatch from that track's clips
  during arrangement playback; the track header shows a clear muted state; mute state persists.*

- [ ] **US-8 — Solo a track**
  As a developer, I want to solo a track, so that I can hear one part in isolation.
  *Acceptance: toggling Solo silences all other tracks (equivalent to muting all non-soloed
  tracks); multiple tracks can be soloed simultaneously; the track header shows solo state.*

- [ ] **US-9 — Adjust track volume (coarse, V1)**
  As a developer, I want a per-track volume control, so that I can balance louder and quieter
  parts without rerecording them.
  *Acceptance: a coarse gain control (e.g. 0–100%, stepped) is in the track header. V1
  constraint: because the engine has no DSP graph, per-track gain is approximated as a
  relative scalar applied to note events for that track (velocity-style scaling where
  applicable) or is noted explicitly as an approximation; the honest capability is documented
  to the user. This story is the most engine-constrained story in V1 and may ship as a visual
  control with deferred behaviour pending KA-1/DSP-graph ADR clarification.*

- [ ] **US-10 — Delete a track**
  As a developer, I want to delete a track (with a guard), so that I can remove a part I no
  longer need without accidentally losing it.
  *Acceptance: deleting a track requires a confirmation step (5-second undo toast preferred,
  matching the recorder's delete guard from DEBT-019); the track and all its clips are removed
  from the arrangement after confirmation or timeout; undo restores the track and its clips.*

#### Clips (placement and basic editing)

- [ ] **US-11 — Place a Recording as a clip**
  As a developer, I want to drag a Recording from my library and drop it onto a track lane
  at a position on the timeline, so that I can hear that phrase play at that moment in the song.
  *Acceptance: a clip instance (a reference to the Recording, with a timeline start position)
  appears on the track; it renders as a block labelled with the Recording name, proportional
  to its duration; placing the same Recording on multiple tracks or at multiple positions is
  supported (a clip is an instance, not a copy of the events).*

- [ ] **US-12 — Move a clip**
  As a developer, I want to drag a clip to a different position (or a different track), so
  that I can rearrange sections without rerecording.
  *Acceptance: dragging a clip updates its timeline start position; snapping to the nearest
  bar/beat is the default; clips can be moved to other tracks.*

- [ ] **US-13 — Duplicate a clip**
  As a developer, I want to duplicate a clip, so that I can repeat a phrase (e.g., play the
  verse groove twice) without re-placing it from the library.
  *Acceptance: a duplicate action creates a new clip instance of the same Recording,
  positioned immediately after the original; the duplicate can then be moved independently.*

- [ ] **US-14 — Delete a clip**
  As a developer, I want to delete a clip from the timeline, so that I can remove a phrase
  that no longer fits.
  *Acceptance: selecting a clip and pressing Delete (or a context-menu action) removes it
  from the track; a 5-second undo toast follows the same pattern as the recorder delete guard.*

- [ ] **US-15 — Resize / trim a clip**
  As a developer, I want to trim the start or end of a clip on the timeline, so that I can
  shorten a Recording to fit a section without affecting the original Recording.
  *Acceptance: dragging the left or right edge of a clip trims the visible region and the
  corresponding event window scheduled during playback; the underlying Recording is unchanged;
  trimmed events outside the window are not dispatched.*

- [ ] **US-16 — Loop a clip**
  As a developer, I want to mark a clip to loop, so that a short phrase (e.g. a 2-bar drum
  groove) fills a longer section automatically without manual duplication.
  *Acceptance: a loop toggle on the clip causes it to repeat its event schedule for the clip's
  full extent on the timeline; the loop repeat count is inferred from the clip's displayed
  length (which the user can set by resizing the clip); overlapping loop iterations dispatch
  correctly without stuck notes.*

- [ ] **US-17 — Transpose a clip**
  As a developer, I want to transpose a clip up or down by semitones, so that I can reuse a
  melody Recording in a different key without rerecording it.
  *Acceptance: a transpose control on the clip (integer semitones, ±12) offsets the `note`
  field of every `note_on`/`note_off` event in that clip instance during dispatch; the
  original Recording is unmodified; out-of-range note numbers after transposition are clamped
  to MIDI range (0–127); Drum preset clips ignore transposition (pitch class re-maps to drum
  type, transposing would change the drum, not the pitch — suppress or warn).*

- [ ] **US-18 — Snap-to-grid**
  As a developer, I want clip placement and moves to snap to a musical grid, so that I do
  not need pixel-perfect precision to place clips in time.
  *Acceptance: snapping is on by default; the grid resolution is configurable (bar, half-bar,
  beat, half-beat); a snap toggle turns snapping off for free-form placement.*

- [ ] **US-19 — Select and multi-select clips**
  As a developer, I want to select one or more clips (click, shift-click, rubber-band drag),
  so that I can move, delete, or duplicate a group at once.
  *Acceptance: selected clips render with a selection highlight; Delete applies to all
  selected; drag moves all selected in unison, preserving relative positions.*

#### Song structure

- [ ] **US-20 — Add section markers**
  As a developer, I want to mark sections on the timeline ruler (Intro, Verse, Chorus,
  Bridge, Outro), so that I can see the song's structure at a glance while arranging.
  *Acceptance: section markers are displayed on the timeline ruler as labelled regions with
  distinct colours; they do not affect playback (they are navigation/visual aids only);
  markers can be renamed and repositioned.*

- [ ] **US-21 — Song-structure templates**
  As a developer, I want to start from a pre-defined section skeleton (Electronic, Rock, or
  Cinematic), so that I do not face a blank timeline when I begin.
  *Acceptance: at workspace creation (or via a "Apply template" action), one of three
  templates pre-populates the section markers with conventional section names and positions
  (example: Electronic = Intro 8 bars / Verse 16 / Drop 16 / Bridge 8 / Outro 8); no tracks
  or clips are created — only markers; the developer can rename, move, or delete any marker.*

#### Playback

- [ ] **US-22 — Arrangement playback (Transport)**
  As a developer, I want to play the arrangement from any position and stop it, so that I can
  hear how sections sound together.
  *Acceptance: Play starts a scheduler that dispatches each clip's events into the existing
  engine `emit()` path at the correct timeline offsets; Stop halts the scheduler and releases
  all held notes (no stuck notes); the playhead advances on the timeline during playback;
  muted tracks are silenced (their events are not dispatched).*

- [ ] **US-23 — Playhead and seek**
  As a developer, I want to click on the timeline to set the playhead position, so that I
  can start playback from a specific bar without always starting from the beginning.
  *Acceptance: clicking on the timeline ruler sets the playhead; playback starts from that
  position; events from clips that start before the playhead but whose event window covers
  the playhead position (mid-clip start) begin dispatch from the correct internal offset.*

- [ ] **US-24 — Loop-region playback**
  As a developer, I want to set a loop region on the timeline and have playback repeat it,
  so that I can focus on a specific section while adjusting clips inside it.
  *Acceptance: the user can set a loop region (start bar / end bar) on the timeline; with
  Loop enabled on the Transport, playback restarts from the loop start when it reaches the
  loop end; loop region is visually distinct on the ruler.*

- [ ] **US-25 — BPM and time-signature settings**
  As a developer, I want to set the song's BPM and time signature, so that the snap grid and
  section positions are musically meaningful.
  *Acceptance: BPM (default 120) and time signature (default 4/4) are configurable in the
  arrangement workspace header and define the bar/beat grid used for snap and quantize;
  supported time signatures for V1: 4/4, 3/4, 6/8. **V1 limitation (documented):** clip
  positions are stored as absolute `startMs` (snapped to the grid at placement time), so
  changing BPM **does not** rescale already-placed clips — full bar-relative rescaling is a
  Later upgrade (see ADR-0007 "bar grid is future" + the canonical `startMs` data model).*

#### AI-assist angle (scoped to V1 minimum)

- [ ] **US-26 — Composition suggestions (AI hook, stub)**
  As a developer, I want the arrangement workspace to surface a suggestion when my library
  contains Recordings that might fit an empty section, so that I have a starting point when
  stuck.
  *Acceptance: when a section has no clips and the Recording library contains candidates (by
  duration fit or name heuristic), a subtle suggestion indicator appears; clicking it opens a
  panel listing the candidates. V1 is a heuristic stub; the full moonozy music agent
  integration (semantic analysis of note content, key/mode detection, harmonic suggestions)
  is a Later milestone once the agent API is defined.*

---

### Later (Post-V1 — gated on DSP-graph ADR)

- [ ] **US-27 — Per-track pan** — independent left/right placement per track. *Deferred: requires
  the engine's DSP graph (stereo routing per voice pool or per track). V1 has one master
  stereo path.*

- [ ] **US-28 — Per-track EQ** — high/mid/low shelf per track. *Deferred: requires the DSP graph.*

- [ ] **US-29 — Per-track reverb / delay** — send-based or insert effects. *Deferred: requires the
  DSP graph. The engine has no effects chain today.*

- [ ] **US-30 — Per-track compressor / limiter** — dynamics control per track. *Deferred: requires
  the DSP graph.*

- [ ] **US-31 — Sends and buses** — group tracks (e.g. "Drums bus"), master send processing.
  *Deferred: requires the DSP graph + bus routing ADR.*

- [ ] **US-32 — Sidechain** — e.g. kick sidechains the bass track for ducking. *Deferred: requires
  the DSP graph + sidechain routing.*

- [ ] **US-33 — Automation lanes** — draw volume/pan/parameter curves over time. *Deferred:
  depends on the DSP graph and a per-parameter automation model.*

- [ ] **US-34 — Crossfades** — smooth gain ramp between adjacent clips. *Deferred: requires either
  audio-level rendering (DSP graph) or a sample-accurate per-event amplitude model.*

- [ ] **US-35 — Clip merge** — flatten two overlapping or adjacent clips into one Recording.
  *Deferred: requires a recording-from-playback path (re-capture the combined event stream)
  and is a new ADR boundary.*

- [ ] **US-36 — Clip split** — split one clip at the playhead into two independent clips. *Later:
  relatively tractable (split the event window at the split point), but low V1 priority and
  subject to the trim/event-offset model from US-15 being validated first.*

- [ ] **US-37 — Full AI-assist** — moonozy music agents performing harmonic analysis on Recording
  event streams, suggesting key, mode, compatible phrases, arrangement templates generated
  from the session content. *Deferred: agent API not yet defined; the V1 stub (US-26) is the
  discovery vehicle.*

- [ ] **US-38 — Audio mixdown export** — render the full arrangement to a WAV file. *Deferred:
  requires the DSP graph, a non-real-time offline renderer, and a new ADR on export
  (extends PRD-003's US-13 export question).*

---

## Scope — Now / Next / Later (+ Out of scope)

**Now (V1 MVP):**
Arrangement workspace with multi-track timeline (create/rename/colour/mute/solo/coarse-volume/
reorder/delete tracks); clip placement via drag-drop from the Recording library (place, move,
duplicate, delete, trim, loop, transpose, multi-select); song-structure templates (Electronic/
Rock/Cinematic section markers); snap-to-grid; playback scheduler feeding the existing engine
`emit()` path; Transport playhead, seek, loop-region, stop with stuck-note release; BPM and
time-signature settings; arrangement persistence to localStorage; AI-assist heuristic stub (US-26).

**Feasibility gate before building the UI (KA-1):** a throwaway TS spike that schedules two
concurrent Recordings into the existing `emit()` path and confirms no stuck notes or ordering
bugs under overlap and stop/restart. If this fails, the arrangement engine must be redesigned
before the UI exists.

**Next (post-V1, no DSP graph required):**
Clip split (US-36) once the trim model is validated; AI-assist full integration (US-37) once
the moonozy agent API is defined; audio export stub (WAV, US-38) once the offline-renderer
question is answered.

**Later (gated on DSP-graph ADR):**
Per-track pan, EQ, reverb, compressor, delay, sends, buses, sidechain, automation lanes,
crossfades, clip merge.

**Out of scope (explicit non-goals for PRD-004 V1):**

1. **Per-track pan, EQ, reverb, compressor, sends, buses, sidechain, automation, crossfades** —
   all require a DSP/mixing graph that does not exist in the Rust engine today. Shipping visual
   controls that make no sound would be dishonest. Gate: a new DSP-graph ADR.
2. **Audio export / WAV mixdown** — extends PRD-003's US-13 deferred question; requires an
   offline renderer and a new ADR.
3. **MIDI I/O** — importing or exporting Standard MIDI Files; no MIDI hardware integration.
4. **Sample-based clips** — importing WAV/MP3 samples onto tracks. The Recording data model is
   symbolic (events), not audio. Samples require a new data type and an audio-file decoder.
5. **Cloud sync or sharing** — single-developer local app; no server infrastructure.
6. **Collaboration** — no multi-user session, no version history beyond localStorage.
7. **Video** — no video track, no score/notation view.
8. **Clip merge** — re-capture of combined event streams is a new ADR boundary (deferred).

---

## Implementation decisions

All implementation decisions that rise to architectural status must be written as ADRs before
development begins. The notes below identify the key decision surfaces; they are not
implementation specs.

**New data model: ArrangementClip and Arrangement.**
A clip is an *instance* of a Recording placed on a track. Field names are **canonical per
[ADR-0007](../../architecture/decisions/ADR-0007-song-arrangement-symbolic-timeline.md) and the
agent [CONTRACT](../../agents/moonozy-music/CONTRACT.md)**: `recordingId`, `startMs` (absolute
timeline position in ms, snapped to the bar grid at placement; see the US-25 BPM limitation),
`transpose` (semitones), `loopCount`, `trimStartMs`, `trimEndMs` (event window offsets into the
Recording); `gainDb` and `fades` are reserved-but-inert Later fields. An Arrangement holds an
ordered list of tracks and their clips, plus the song metadata (`tempoBpm`, `timeSig`, section
markers). Persisted to localStorage as `musicware.arrangements.v1`. Key design rule: a clip references a Recording by
id — it is an instance, not a copy of the events. If the Recording is deleted, the clip becomes
a "dangling clip" (must be handled gracefully — either auto-remove or show as unresolved).

**Arrangement scheduler.**
The arrangement playback scheduler is a new TS module (distinct from `useRecorder`'s single-clip
replay). It must:
- Convert bar/beat positions to wall-clock offsets using the current BPM.
- Schedule concurrent event streams from multiple clips overlapping in time.
- Handle mid-clip seek (start dispatch from a non-zero event offset).
- Handle stop by releasing all held notes (same stuck-note safety as `useRecorder`).
- Gate events from muted tracks.
- Apply per-clip transpose offset to `note_on`/`note_off` note numbers.
The `setTimeout`-based scheduler from ADR-0002 is the starting point; for a multi-clip
arrangement, event interleaving correctness and stuck-note safety under abort are the
load-bearing concerns. This scheduler is the subject of feasibility spike KA-1.

**V1 per-track gain approximation.**
Because there is no DSP graph, V1 per-track gain cannot be true independent per-track audio
routing. Options (to be decided in the KA-1 spike or a focused ADR):
- Option A: velocity scaling — for `note_on` events, scale the note's amplitude by encoding
  a velocity into the event (requires the Rust engine to accept a velocity parameter on
  `note_on` — a new Tauri command argument, a small engine change).
- Option B: serial gain — emit a `set_volume` before each clip's events and restore after.
  This is technically incorrect for simultaneous clips (last writer wins) and is not an honest
  per-track gain; it would be dropped in favour of Option A or deferred.
- Option C: defer — ship US-9 as a visual control with no audio behaviour in V1, pending the
  DSP-graph ADR. Honest and safe; may feel incomplete.
The decision between A and C must be made before US-9 is implemented. B is not recommended.

**Song-structure templates.**
Templates are static JSON fixtures defining section names and bar positions. They are not
generated by AI in V1. The three templates (Electronic, Rock, Cinematic) are chosen for their
recognisability to a beginner. Each template is a list of `{name, startMs, endMs, colour}` section objects (positions derived from conventional bar counts at the song's default tempo).
The AI-assist integration (US-26/37) may replace or augment this in a Later release.

**AI-assist stub (US-26).**
V1 is a pure heuristic: check the Recording library for Recordings whose `durationMs` is
within ±20% of an empty section's bar count at the current BPM, and surface them as
candidates. No semantic analysis of events, no key detection, no network call. This creates
the UI surface and the interaction pattern that the moonozy music agents will plug into later.

**No new Tauri commands required for V1 arrangement playback** (assuming Option C or velocity
scaling for gain). Mute/solo operate on the TS scheduler (event gating), not on the Rust engine.
If Option A (velocity) is chosen, one new Tauri command argument is needed: `note_on { note,
velocity: f32 }` where velocity scales the voice amplitude. That is a targeted engine addition,
not a DSP graph.

---

## Testing decisions

The arrangement surface has two distinct testing targets: the scheduler logic (pure TS, high
test value) and the UI (drag-drop, track controls — tested via React Testing Library).

**Scheduler tests (vitest, pure TS):**
- Two clips on different tracks with the same start bar dispatch events in correct interleaved
  order.
- A muted track's events are not dispatched.
- Stop releases all held notes (no stuck notes after abort).
- A looped clip repeats its event window the correct number of times.
- Trimming a clip suppresses events outside the trim window.
- Transpose offset is applied to `note_on`/`note_off` note numbers.
- Mid-clip seek dispatches only events whose `t` offset is at or after the seek point.
- Snapping a new clip aligns its `startMs` to the nearest bar/beat grid line at the current BPM.
- A dangling clip (referenced Recording deleted) does not crash the scheduler.

**Track/clip lifecycle tests (vitest + React Testing Library):**
- Adding a track creates it in state with a unique id.
- Deleting a track with undo guard: track is NOT removed on first action, IS removed after
  confirmation or timeout.
- Renaming a track commits on Enter, cancels on Escape.
- Placing a clip creates a clip instance referencing the Recording id (not a copy).
- Moving a clip updates its `startMs`.
- Duplicating a clip creates a new clip instance at the expected `startMs` offset.

**Acceptance (manual):**
- Load three Recordings, place one on each of three tracks, hit Play, hear all three play
  together starting at their respective positions, hit Stop — no stuck notes.
- Mute track 2, play again — track 2 is silent, tracks 1 and 3 play.
- Apply the Rock template, confirm markers appear at expected bar positions.

No new E2E harness is introduced. The scheduler is the highest-value unit under test; favour
unit tests over integration/E2E for the core scheduling logic.

---

## Discovery evidence & open questions

**Opportunity Solution Tree branch.**

- **Outcome:** developer assembles a complete multi-section song from saved Recordings (PRD-004 headline metric).
  - **Opportunity:** Recordings from PRD-003 are isolated islands — no way to arrange fragments in time or hear them together.
    - **Solution A — symbolic multi-track arrangement timeline (V1 scope of this PRD):** place/move/loop/duplicate/trim clips on a timeline; section templates; playback scheduler into the existing engine. Experiment: OQ-1 (does the developer actually think in terms of "verse"/"chorus," or would longer single Recordings suffice?).
    - **Solution B — longer single-Take recordings with markers:** keep one-track model; add in-Take section markers and jump-to-marker navigation. Simpler; zero engine risk; but does not address multi-part arrangement. Experiment: OQ-2 (would a single longer Take with markers satisfy the assembly desire, or is multi-track the essential step?).
    - **Solution C — AI-generated arrangement suggestions:** the moonozy agent proposes a full arrangement from the library; the user approves/edits. Deferred: agent API undefined; Solutions A+B are the honest V1 envelope. Experiment: US-26 stub is the discovery vehicle.

**Unvalidated assumptions.**

| # | Assumption | Discovery activity |
|---|---|---|
| OQ-1 | The developer wants multi-track arrangement, not just longer single-Take recordings | Before building: in 2 practice sessions, observe whether the developer saves Recordings that are clearly meant as *parts* of a larger song (verse groove, chorus melody) or as self-contained performances. If the latter, Solution B may dominate. |
| OQ-2 | Song-structure templates (Verse/Chorus/Bridge) reduce blank-canvas disorientation enough to make the timeline approachable without prior DAW experience | PoC wireframe test (OQ-3) — show the template-populated timeline to the developer, observe whether they can place their first clip in under 2 minutes without verbal prompts. |
| OQ-3 | A PoC wireframe is the right tool to validate the timeline UX before committing to the full build | Build a static HTML/CSS wireframe of the arrangement workspace (similar to POC-002 for the keyboard) and use it to test OQ-2. If the wireframe is too static to reveal the drag-drop interaction, an interactive prototype (Figma or minimal React) is justified. |
| OQ-4 | The `setTimeout`-based multi-clip scheduler can handle concurrent event streams from 3+ clips without observable timing errors or stuck notes | KA-1 spike: two overlapping Recordings dispatched simultaneously; stop/restart under load. Pass/fail gate before the arrangement UI is built. |
| OQ-5 | 16 voices (the current polyphony ceiling) is sufficient for a typical 3-track arrangement (melody + chords + drums); voice stealing is not perceptibly disruptive | KA-2 probe: play a typical arrangement (melody holding 4 voices + chords holding 4–6 + 1–2 drum hits) and count peak concurrent voices. If routinely > 16, voice ceiling is a user-visible problem requiring an engine increase before V1 ships. |
| OQ-6 | Per-track volume without a DSP graph (V1 approximation) is honest enough to ship; users will not notice the constraint | Decide via the Option A/C trade-off (see Implementation decisions). If Option C (defer gain behaviour) is chosen, validate that mute/solo alone is sufficient for the MVP mixing experience. |

---

## Links

- Business case: `docs/product/business-cases/BC-001-musicware-learning-daw.md`
- Architecture decisions: `docs/architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md`,
  `docs/architecture/decisions/ADR-0002-composition-recording-frontend-event-stream.md`,
  `docs/architecture/decisions/ADR-0003-master-volume-post-render-limiter.md`
- Related PRDs: PRD-001 (musicware MVP), PRD-002 (playable keyboard synth), PRD-003 (composition recorder — the source of the Recordings this workspace arranges)
- Required spikes (not yet opened): KA-1 (multi-clip TS scheduler), KA-2 (voice-ceiling probe), OQ-3 (timeline UX wireframe)
- Tracker issues: local checklist above (tracker.mode = local)
- Shipped: not yet — this is a forward-looking PRD; no code exists for PRD-004
