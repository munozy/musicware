# TS-001 — Song Arrangement: ordered build slices

> Owner: Architecture (`moonozy-architect`). Type: technical spec (how-to-build RFC). First TS in the project.
> Date: 2026-06-26. Status: **Active**.
> Implements: [PRD-004](../../product/prds/PRD-004-song-arrangement.md) (US-1..26) within
> [ADR-0007](../decisions/ADR-0007-song-arrangement-symbolic-timeline.md) (Accepted 2026-06-26).
> UX source of truth: [DESIGN-002](../../product/design/DESIGN-002-song-arrangement-workspace.md).
> Glossary: [docs/CONTEXT.md](../../CONTEXT.md) (canonical — extend, never contradict).

---

## 0. What is already built (do not rebuild)

The KA-1 feasibility gate shipped the **pure scheduler core and the canonical data model** in
`src/arrangement.ts` (merged on main, 22 gate tests green). This spec builds the UI/state leaf *on top of*
that — it does **not** re-derive the scheduler.

Already in `src/arrangement.ts` (reuse verbatim):
- **Types:** `ClipInstance`, `Track`, `Section`, `Arrangement`, `ScheduledEvent`. (Note: the merged shapes are
  slightly richer than ADR-0007's illustrative TS — `Track` carries `color`/`soloed`; `Arrangement` carries
  `timeSig`/`sections`; trims are `?: number | null`. The merged file is the canonical implementation shape.)
- **`flattenArrangement(arr, recordings)` → `ScheduledEvent[]`** — pure; applies solo-over-mute, transpose
  clamping, loop unrolling, trim windows, dangling-clip skip, same-instant ordering (preset → off → on).
- **`flattenClip` (internal)** — per-clip expansion with the self-close (no-stranded-note) guarantee.
- **`pendingNotesAfter(events, untilT)`** — the no-stranded-note invariant probe; reused by tests + seek.
- **`playArrangement(events, emit, timers?)` → `Player`** — `setTimeout`-class dispatch with injectable
  timers; `stop()` cancels pending + releases everything sounding. Idempotent stop.

Architectural invariants this spec must preserve (non-negotiable):
- **ADR-0001:** audio samples never cross IPC; the Rust engine is **untouched** in V1. No new Tauri commands.
- **ADR-0002:** dispatch only through `src/synth.ts` `emit()` (which does NOT tap the recorder sink, so
  arranging never records itself). Reuse the note broadcast so keyboard/chord/visualizer light up for free.
- **ADR-0007:** symbolic, UI-owned, `localStorage` (`musicware.arrangements.v1`); single global preset →
  the per-track-instrument tension is **surfaced, not solved** in V1; forward-looking fields persist but are
  inert. The engine stays single global preset.
- **Building-block model + Tier-1 simplicity** (CONTEXT.md): a composition is a reusable brick; Tier 1 hides
  all pro controls. Every slice keeps the beginner happy path one drag away.

---

## 1. Module / component map (introduced across the spec)

| Artefact | Kind | Test seam | Introduced |
|---|---|---|---|
| `src/arrangement.ts` | pure scheduler + types | unit (vitest) — **exists** | — |
| `src/useArrangement.ts` | state hook (mirrors `useRecorder.ts`) | unit (vitest + RTL `renderHook`) | Slice 1 |
| `src/arrangementStore.ts` | pure load/save/new helpers (mirrors `recordings.ts` `load/save/newId`) | unit (vitest) | Slice 1 |
| `src/ModeToggle.tsx` | `[Play\|Song]` topbar pill | RTL | Slice 1 |
| `src/SongView.tsx` | Song-mode shell (shelf + transport + timeline) | RTL | Slice 1 |
| `src/ClipShelf.tsx` | saved-Recordings drag-source list | RTL | Slice 1 |
| `src/Timeline.tsx` | ruler + track lanes + drop targets + playhead | RTL | Slice 1 |
| `src/SongTransport.tsx` | Play/Stop + elapsed + (later) tempo/loop | RTL | Slice 1 |
| `src/TrackHeader.tsx` | name/colour/mute/solo controls | RTL | Slice 3 |
| `src/Clip.tsx` | clip block (label, note-dots, resize handles) | RTL | Slice 4/5 |
| `src/SectionBand.tsx` | section markers + template paint | RTL | Slice 6 |

**State ownership.** `useArrangement` owns the in-memory `Arrangement` (single active arrangement for V1),
persists on change (mirrors `useRecorder`'s `useEffect` save), and exposes the playback `Player`. `App.tsx`
holds the `mode` (`"play" | "song"`) and renders `<SongView>` instead of the keyboard stage when in Song mode.
Recordings stay owned by `useRecorder`; `SongView` receives `recordings` as a prop (read-only) so the shelf
and the scheduler share one source of truth for events. **A clip stores `recordingId`, never events** (ADR-0007).

---

## 2. Slice 1 — Walking skeleton (specified for immediate TDD)

> **Goal:** a beginner toggles to Song, sees their saved Recordings, drops ONE clip onto ONE lane at a time
> position, presses Play, and hears it through the existing engine. End-to-end: UI → state → `flattenArrangement`
> → `playArrangement` → `emit` → engine. Smallest thing that proves the whole pipe.

**Delivers (partial):** US-1 (mode toggle / open workspace), US-2 (persistence), US-11 (place a Recording as a
clip — single placement), US-22 (Play/Stop through the scheduler with stuck-note-safe stop). It deliberately
does NOT do drag-move, multi-track creation UI, tracks controls, sections, or BPM grid.

### 2.1 New modules and their contracts

**`src/arrangementStore.ts`** (pure — highest test value first):
- `loadArrangement(): Arrangement` — read `musicware.arrangements.v1`; tolerate missing/corrupt → return a
  fresh default arrangement (NOT a crash). Mirror `recordings.ts` `loadRecordings`.
- `saveArrangement(a: Arrangement): void` — JSON to localStorage, try/catch like `saveRecordings`.
- `newArrangement(): Arrangement` — one default Track (`name:"Track 1"`, `presetIndex:0`, `clips:[]`,
  `muted:false`, `soloed:false`, a default colour), `tempoBpm:120`, `timeSig:[4,4]`, `sections:[]`,
  `createdAt: Date.now()`, `id: newId()`. (Reuse `newId` from `recordings.ts`.)
- `addClip(a, trackId, recordingId, startMs): Arrangement` — returns a new arrangement with a fresh
  `ClipInstance` (`transpose:0`, `loopCount:1`) appended to the track. Pure, immutable update.

**`src/useArrangement.ts`** (state hook, mirrors `useRecorder`):
- State: `arrangement` (from `loadArrangement()`), `isPlaying`, `playingPlayer: Player | null`.
- `useEffect` persists `arrangement` on every change (mirror `useRecorder`).
- `placeClip(trackId, recordingId, startMs)` → `setArrangement(addClip(...))`.
- `play(recordings)` → guard if already playing; `const events = flattenArrangement(arrangement, recordings)`;
  `const player = playArrangement(events, emit)`; store player; set `isPlaying`; clear on end (a timer at
  `last event t + 1`, mirroring `useRecorder.play`'s end timer) — release is already handled by `Player.stop`.
- `stop()` → `player.stop()` (releases held notes), clear `isPlaying`.
- Unmount cleanup calls `stop()` (no stranded voices on HMR / mode switch), mirroring `useRecorder`.

### 2.2 New components

**`src/ModeToggle.tsx`** — the `[ Play | Song ]` pill (DESIGN-002 §1). Two-segment toggle in the topbar,
centred. `aria-pressed` on each segment; Left/Right arrow keys move within the group (`role="group"`,
`aria-label="View mode"`). Props: `mode`, `onChange`. **Block the switch to Song while recording** with a
tooltip ("Stop recording first") — `App` passes `rec.isRecording`.

**`src/SongView.tsx`** — fills `<main>` (and replaces the keyboard `<footer>` dock) when `mode==="song"`.
Composes `ClipShelf` (left), `SongTransport` (top), `Timeline` (centre). Owns nothing; wires `useArrangement`
to children. If `recordings.length === 0`, show the DESIGN-002 §9 risk-2 interstitial ("You haven't recorded
anything yet. [Go record →]") which flips `mode` back to Play.

**`src/ClipShelf.tsx`** — left panel (~220px). Lists `recordings` as draggable cards (name + duration via
`formatDuration`). Each card is `draggable`; `onDragStart` sets `dataTransfer` with the `recordingId`
(`text/plain` payload, e.g. `"clip:<recordingId>"`). Accessibility per DESIGN-002 §8: a keyboard fallback
"Place on track" affordance is **deferred to Slice 2** (note it; Slice 1 is pointer-drag only, acceptable for
the skeleton). Cards carry the "drag me" affordance (dotted border + grip).

**`src/Timeline.tsx`** — the ruler + one track lane (Slice 1 renders the single default track only). Lane is a
drop target: `onDragOver` preventDefault, `onDrop` reads `recordingId` from `dataTransfer`, computes `startMs`
from the drop x-offset against a fixed **px-per-ms** scale (a module constant, e.g. `PX_PER_SEC = 40`), and
calls `placeClip(trackId, recordingId, startMs)`. **No snapping in Slice 1** (snap is US-18, Slice 7) — round
to nearest 100 ms so the skeleton stays usable. Render placed clips as plain blocks (label + width =
`durationMs × pxPerMs`). A playhead element is rendered but static unless playing.

**`src/SongTransport.tsx`** — Play (`▶`) / Stop (`■`) only in Slice 1, wired to `useArrangement.play(recordings)`
/ `stop()`. Elapsed-time readout reuses `formatDuration`. `aria-live="polite"` announces "Playing"/"Stopped"
(DESIGN-002 §4). Tempo/loop controls deferred to their slices.

### 2.3 App wiring
- `App.tsx` gains `const [mode, setMode] = useState<"play"|"song">("play")` and renders `<ModeToggle>` in the
  topbar (between brand and Transport, per DESIGN-002 §1) and `<SongView recordings={rec.recordings} … />` in
  place of the stage/dock when `mode==="song"`. Existing Play layout is untouched in Play mode.

### 2.4 Test seams + Slice-1 acceptance

**Unit (vitest — pure, no DOM):**
- `arrangementStore.test.ts`: `loadArrangement` returns default on empty/corrupt storage; `newArrangement` has
  exactly one track and the canonical defaults; `addClip` appends an instance referencing the id (NOT a copy of
  events) and is immutable (input arrangement unchanged); `saveArrangement` round-trips through `loadArrangement`.
- (Scheduler already covered by `arrangement.test.ts` — do not duplicate.)

**Hook (vitest + RTL `renderHook`):**
- `useArrangement.test.tsx`: `placeClip` mutates state + persists; `play` calls a **mocked `emit`** with the
  expected on/off sequence for one placed clip (assert via fake timers, the `arrangement.ts` pattern);
  `stop()` releases held notes (assert `emit({kind:"off"})` for sounding notes); unmount calls stop.

**Component (vitest + RTL):**
- `ModeToggle.test.tsx`: clicking Song fires `onChange("song")`; `aria-pressed` reflects mode; blocked while
  recording (disabled + tooltip).
- `SongView.test.tsx`: renders shelf + timeline; empty-recordings interstitial path.
- `Timeline.test.tsx`: a `drop` event with a `recordingId` payload calls `placeClip` with a computed `startMs`;
  a placed clip renders a labelled block of the right proportional width.

**Slice-1 acceptance (manual + the headline DISCOVERY-001 signal):**
1. Toggle Play→Song; the shelf lists existing Recordings (or the interstitial if none).
2. Drag one Recording onto the lane at ~bar 2; a labelled clip block appears at that x.
3. Press Play; the clip sounds through the engine at its offset; the keyboard/visualizer light up (free via the
   note broadcast). Press Stop mid-clip — **no stuck note** (verify via the scheduler's release path).
4. Reload the app; the placed clip is still there (persistence).
5. **Carry the DISCOVERY-001 n=1 caveat:** an external beginner should reach step 3 unaided and *move* a clip
   after hearing it — that move arrives in Slice 2; an external-beginner confirmation rides along on Slices 1–2
   (it does **not** block the build).

---

## 3. Ordered slices (value + de-risking first)

Each slice is independently shippable and end-to-end. US in **bold** are V1 (PRD-004 "Now"); items marked
*(Later)* are explicitly out of V1 scope.

| # | Slice | Delivers (US) | Why here |
|---|---|---|---|
| 1 | **Walking skeleton** — mode toggle, shelf, drop one clip on one lane, Play/Stop through scheduler + persist | **US-1**(partial), **US-2**, **US-11**(single), **US-22** | Proves the whole pipe; unblocks the headline learning loop with the least code. |
| 2 | **Move a clip** — drag a placed clip horizontally; keyboard "Place on track" fallback | **US-12**, completes **US-1** a11y | Delivers the **headline DISCOVERY-001 signal** (move after hearing) — highest validated value. |
| 3 | **Multi-track** — Add Track, rename, colour, reorder, delete (5s-undo guard), and place across tracks | **US-3, US-4, US-5, US-6, US-10**, completes **US-11** (multi-track) | Makes it a *multi*-track arrangement; mute/solo already honoured by `flattenArrangement`. |
| 4 | **Mute / Solo** — track-header M/S wired to the (already-supported) flatten gating | **US-7, US-8** | Smallest mixing experience the engine honestly supports; surfaces the Tier-1 "balance" need without a DSP graph. |
| 5 | **Clip editing** — duplicate, delete (undo), trim (resize), loop, transpose | **US-13, US-14, US-15, US-16, US-17** | All map 1:1 to existing `flattenClip` params (trim/loop/transpose are already implemented) — pure-state changes feeding a proven flattener. |
| 6 | **Song structure** — section band, add/rename/move markers, templates (Electronic/Rock/Cinematic) | **US-20, US-21** | The PRD's #1 usability mitigation (blank-canvas cure); markers are visual-only (don't gate playback). |
| 7 | **Grid + transport polish** — snap-to-grid, BPM/time-sig, playhead/seek, loop-region | **US-18, US-23, US-24, US-25** | Musical precision; comes after content placement works. US-25 carries the documented "BPM doesn't rescale placed `startMs`" limitation. |
| 8 | **Select / multi-select** — click, shift-click, rubber-band; group move/delete/duplicate | **US-19** | Efficiency layer over slices 2/5; needs them first. |
| 9 | **AI-assist stub** — heuristic "Suggest what fits" (duration-fit candidates for an empty section) | **US-26** | Pure-heuristic UI hook; lowest value/highest optionality, last in V1. |

**Cross-cutting, every slice:** the **per-track-instrument tension is surfaced, not solved** — when a track's
`presetIndex` differs from another's and their clips overlap, the UI must warn ("tracks with different
instruments can't play at the exact same time yet"), per ADR-0007. Add this advisory in Slice 4 (when tracks +
mute/solo make multi-instrument arrangements realistic) and keep it through V1. The engine stays single global
preset.

### V1 vs Later (PRD-004)
- **V1 (this spec, slices 1–9):** US-1..26.
- **Already-Later (NOT in this spec; gated on a future DSP-graph ADR):** US-27 pan, US-28 EQ, US-29
  reverb/delay, US-30 compressor, US-31 sends/buses, US-32 sidechain, US-33 automation lanes, US-34 crossfades,
  US-35 clip merge, US-36 clip split, US-37 full AI-assist, US-38 audio mixdown export. **US-9 (per-track coarse
  volume) is intentionally NOT scheduled** in slices 1–9: ADR-0007 makes per-track gain inert without the V2b
  mixer; ship it only as a deferred/disabled control (PRD Option C) or fold into the Later DSP-graph ADR — do
  not build audio behaviour for it in V1.

---

## 4. Conventions
- Match the existing src layout: flat `src/`, one component per file, co-located `*.test.ts(x)`, vitest + RTL.
- Mirror `useRecorder.ts`/`recordings.ts` patterns (load/save/newId, `useEffect`-persist, undo-toast guard,
  unmount cleanup that releases notes) so the arrangement leaf reads like the recorder leaf.
- No new Tauri commands. No `src-tauri/` changes anywhere in slices 1–9.

## Links
PRD: [PRD-004](../../product/prds/PRD-004-song-arrangement.md) · ADR: [ADR-0007](../decisions/ADR-0007-song-arrangement-symbolic-timeline.md)
(Accepted) · Design: [DESIGN-002](../../product/design/DESIGN-002-song-arrangement-workspace.md) · Discovery:
[DISCOVERY-001](../../product/discovery/DISCOVERY-001-arrangement-value-usability.md) (OQ-3 Gate A PASSED, n=1 caveat) ·
Scheduler: `src/arrangement.ts` (KA-1, merged) · Glossary: [docs/CONTEXT.md](../../CONTEXT.md)
