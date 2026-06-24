# PRD-003 — Composition recorder

> Owner: developer (solo). Date: 2026-06-24. Status: **Draft**.
> Scope: a frontend-only composition recorder built on top of the playable synth (PRD-002).
> tracker.mode = local — work items tracked as a checklist below and in `state.openDebt`.
> **Retroactive discovery PRD.** The MVP was built and merged (PR #1, commit 6c9d383) before this
> document existed. The Moonozy council flagged that as solution-first and opened DEBT-018. This PRD
> frames the problem and outcome the recorder serves, scores the 4 risks honestly against what is
> already shipped, and maps the open Value/Usability questions to the next validated increments.
> The Feasibility risk is largely retired — the feature shipped, CI is green, and the Rust engine
> is untouched (ADR-0002). Value and Usability remain genuinely open.

---

## Problem & opportunity

PRD-002 gave the developer a playable keyboard synth. The synth is momentary: press a key, hear a
note, release it — and it is gone. A learner cannot revisit what they played, compare two attempts
at a phrase, or build incrementally on a musical idea across practice sessions.

The opportunity is the **capture-and-revisit loop**: record a short performance as a Take, name it,
play it back, compare it to a new attempt, and iterate. That loop is the feedback mechanism that
turns a playable instrument into a practice and composition tool — the stated learning goal in BC-001.

Why now: the synth dispatch choke point (`src/synth.ts`) already concentrates every note/preset
event the UI produces. Tapping it is minimal incremental surface — no new engine risk, no new
subsystem. The window where this is cheap to add is open now, before the codebase grows.

---

## Outcomes & success metrics

**One measurable outcome — the developer uses the capture-and-revisit loop across practice sessions,
not just to verify it works.**

| Signal | Observable pass definition |
|---|---|
| Replay is reached | Developer replays a Take in the same session it was recorded (beyond "does it work") |
| Cross-session use | At least one Take persists across an app restart and is intentionally replayed in a later session |
| Naming is exercised | Takes are renamed to meaningful labels (not left as "Composition N") — evidence the Takes are worth keeping |
| Loop is used for improvement | Developer records a second Take of the same phrase after hearing the first — the feedback loop closes |

The headline signal is the last one: a **second recording of the same phrase**. That is the
difference between "feature works" and "feature serves the learning goal".

---

## The 4 risks (and how each is addressed)

**Value — MEDIUM (the genuine open question).**
The recorder does what it was designed to do. The unvalidated assumption is whether the developer
actually uses replay to improve their playing, or whether the real want is an **audio export** to
share or archive — a want that localStorage-only replay cannot satisfy. Discovery activity: keep a
3-session usage log (which Takes are replayed vs. deleted; whether any Take prompted a re-recording
of the same phrase). If replay-for-improvement never fires, the honest conclusion is that export,
not replay, is the value driver and the scope needs to shift. See open questions OQ-1 and OQ-2.

**Usability — MEDIUM.**
DESIGN-001 is the post-hoc heuristic review. The recorder is semantically well-marked and
functionally solid. Three gaps warrant action before the loop becomes reliable: (1) delete is
single-click and irrecoverable — a mistake destroys a Take permanently (High, DEBT-019); (2)
replay has no progress indicator — the user cannot tell where in a long Take playback is (Moderate);
(3) the rename affordance is hover-only, invisible to keyboard and touch users (Moderate). Items 4
and 5 from DESIGN-001 — focus loss after rename/delete and the disabled-button contrast failure
(WCAG 1.4.11) — are bundled into DEBT-020.

**Feasibility — LOW (largely validated).**
The feature shipped green. It is a frontend-only leaf: capture and replay happen entirely in
TypeScript at the synth dispatch choke point (ADR-0002); the Rust audio engine and all its
real-time safety proofs are untouched. There is no new IPC surface and no engine risk. Residual
feasibility questions (localStorage quota, `setTimeout` replay jitter on long Takes) are tracked as
accepted costs in ADR-0002 with known mitigations. No feasibility spike is warranted.

**Business viability — N/A.**
Personal learning project, no GTM, no revenue. Viability = sustained motivation. The recorder
serves motivation by making the synth replayable; the risk is losing motivation to address the open
Value question rather than any commercial concern.

---

## Users / personas

**The developer.** Solo engineer learning audio DSP and Rust+React desktop architecture; also the
sole user. Wants to practise short musical phrases, hear them back, and build compositional ideas
incrementally across sessions. (BC-001, PRD-002.)

---

## Solution narrative

After playing a phrase on the keyboard, the developer clicks Record. The button turns red and a
live timer confirms the take is being captured. They play the phrase — every note and preset
switch is silently logged with a timestamp. Clicking Stop saves the Take, names it
"Composition N" by default, and adds it to the list below the keyboard.

Clicking Play on a row re-dispatches the logged events to the engine on the original schedule:
the keys light up in sync, the audio matches what was played. The developer hears the phrase back,
spots a timing slip, and records again. The two Takes sit side by side. They rename the better one,
delete the other. The loop has closed: play, capture, review, improve.

Takes persist across sessions in localStorage. On the next launch they are still there. The
developer can build a short composition one phrase at a time.

---

## User stories

### Now / done (shipped in PR #1)

- [x] **US-1** As a developer, I want to arm a recording and stop it, so that a Take capturing my
  note and preset events is saved.
  *Acceptance: Record arms the capture sink; Stop saves a non-empty Take (empty Takes are
  discarded); a live timer shows elapsed time during recording.*

- [x] **US-2** As a developer, I want to replay a saved Take, so that I can hear exactly what I
  played.
  *Acceptance: Replay re-dispatches the timestamped event stream via the synth dispatch path;
  the audio matches the original performance by construction (same engine, same voices).*

- [x] **US-3** As a developer, I want the keyboard to light up during replay, so that I can see
  which notes are sounding.
  *Acceptance: Key highlights are driven by a single note-broadcast refcount at the dispatch
  point — live and replay light the same keys from the same source (ADR-0002).*

- [x] **US-4** As a developer, I want the active preset stamped at the start of each Take, so that
  replay always sounds as recorded regardless of what preset is selected now.
  *Acceptance: A `preset` event is inserted at t=0 on record-arm; replay re-dispatches it
  before any note events.*

- [x] **US-5** As a developer, I want to rename a Take, so that I can give meaningful labels to
  performances I want to keep.
  *Acceptance: Clicking the Take name opens an inline edit; Enter commits, Escape cancels,
  blur commits; empty draft restores original name.*

- [x] **US-6** As a developer, I want to delete a Take, so that I can remove performances I do not
  want to keep.
  *Acceptance: The delete button removes the Take from the list and from localStorage.*

- [x] **US-7** As a developer, I want Takes to persist across app restarts, so that I can build
  on previous sessions.
  *Acceptance: Takes are written to localStorage on every change; they reload on app start.*

### Next (validated increments — mapped to open debt)

- [ ] **US-8 — Delete guard** (DEBT-019, High)
  As a developer, I want a confirmation step before a Take is deleted, so that I cannot
  accidentally destroy a recording I wanted to keep.
  *Acceptance: Deleting requires a second action (confirm dialog or 5-second undo toast);
  the Take is only removed after confirmation or undo window expiry.*

- [ ] **US-9 — Playback progress indicator** (DEBT-020, Moderate)
  As a developer, I want to see where in a Take playback is, so that I can orient myself in
  a longer recording.
  *Acceptance: A progress bar or elapsed/total readout updates during replay, keyed to
  `durationMs` already stored on the Take.*

- [ ] **US-10 — Rename discoverability** (DEBT-020, Moderate)
  As a developer, I want a static visual cue that a Take name is editable, so that I can
  discover the rename action without hovering.
  *Acceptance: A persistent edit affordance (e.g. pencil icon or dashed underline) is visible
  on the name without hover, and is keyboard-reachable.*

- [ ] **US-11 — Focus restoration after rename and delete** (DEBT-020, Moderate / WCAG 2.4.3)
  As a keyboard user, I want focus to return to a predictable element after renaming or
  deleting a Take, so that I do not lose my place in the list.
  *Acceptance: After rename commit/cancel, focus returns to the Take's name button. After
  delete, focus moves to the next Take row, or to the Record button if the list is now empty.*

- [ ] **US-12 — Disabled controls contrast** (DEBT-020, WCAG 1.4.11)
  As a low-vision user, I want disabled volume buttons to meet WCAG contrast minimums, so
  that I can tell the difference between absent and inactive controls.
  *Acceptance: The disabled −/+ buttons achieve at least 3:1 contrast ratio; opacity alone
  is not the only treatment.*

### Later (deferred — see Out of scope)

- [ ] **US-13 — Disk / audio export** — export a Take as a WAV or SMF file for archival or
  sharing. *Deferred: localStorage-only is the ADR-0002 accepted cost; export requires a new
  ADR on storage/format.*

- [ ] **US-14 — Preset selector highlight during replay** — the preset button re-highlights as
  replay re-dispatches preset events. *Deferred: ADR-0002 accepted cost; medium implementation
  complexity for low user impact.*

- [ ] **US-15 — Mute affordance at 0% volume** — the speaker icon switches to a muted state when
  the level is 0. *Deferred: low severity, one-liner when volume UX is revisited.*

---

## Scope — Now / Next / Later (+ Out of scope)

**Now / done (PR #1):** Record/Stop capturing a Take; replay with key-sync; rename (inline); delete;
localStorage persistence; multi-Take list; preset-at-t=0 faithful timbre.

**Next (DEBT-019 + DEBT-020):** Delete guard (confirm or undo toast); playback progress indicator;
rename static affordance; focus restoration after rename/delete; disabled-button contrast fix.

**Later:** Disk export (WAV or SMF, requires a new ADR); preset selector highlight during replay
(ADR-0002 accepted cost); mute affordance at 0%; slider keyboard step improvement.

**Out of scope (explicit non-goals for PRD-003):**
- **Audio export / MIDI (SMF) export** — localStorage-only is an accepted ADR-0002 cost; export
  is a future ADR boundary, not this PRD.
- **Multi-track or overdub** — one Take = one recorded performance; layering belongs in PRD-001's
  recording DAW roadmap.
- **Sample-accurate timing** — `setTimeout`-based replay with event-loop jitter is the accepted
  cost; a sample-clock scheduler is a future ADR if jitter becomes audible.
- **Cross-device or cloud sync** — out of scope for a single-developer personal tool.
- **Master volume recording** — `setVolume` is an output/monitor setting deliberately excluded
  from capture (ADR-0002, ADR-0003).

---

## Implementation decisions

All recording decisions are in **ADR-0002** — do not restate the architecture here; read that
document first. Summary of the load-bearing decisions:

- Capture is a sink installed on the `src/synth.ts` dispatch choke point; replay re-issues
  through `emit()` without re-tapping the sink (no recursive recording).
- The Take data model (`Recording`, `RecEvent`) is plain versioned JSON in localStorage
  (`musicware.recordings.v1`); the key is stable and migration-ready.
- Note highlights are driven by a single broadcast + refcount at the dispatch point; live and
  replay share one code path by construction.
- The C4 container diagram does not yet show the recorder component; refreshing it is tracked as
  **DEBT-021** — this PRD inherits that diagram debt.

Next-increment implementation notes (for US-8–US-12) are deliberately thin — implementation detail
belongs in the story, not the PRD. The one constraint worth stating: the delete-guard (US-8) must
not introduce a blocking modal that traps keyboard focus; a non-blocking undo toast is the preferred
pattern and avoids creating a new a11y surface.

---

## Testing decisions

The existing vitest suite (PR #1) covers the core Take lifecycle: capture, auto-close of held notes
at stop, empty-take discard, stuck-note release on unmount, localStorage load/save tolerance (corrupt
or missing storage returns `[]`), and the no-recursive-recording invariant (replay does not re-tap
the sink). These are the behavioral tests; they test the Take lifecycle, not implementation wiring.

For US-8 (delete guard): test that a Take is NOT removed on the first delete action and IS removed
only after confirmation — without testing which UI pattern (toast vs. dialog) implements the guard.

For US-9 (progress indicator): test that elapsed-ms tracking advances monotonically during replay
and halts on stop — the UI rendering of a progress bar is a consequence.

For US-11 (focus restoration): test via `userEvent` in vitest that after rename commit and after
delete, the focused element is the expected target (name button / next row / Record button).

No browser automation or E2E harness is introduced. Manual acceptance: replay a 30-second Take and
confirm the progress indicator reaches 100% and stops.

---

## Discovery evidence & open questions

**Opportunity Solution Tree.**

- **Outcome:** developer gains hands-on audio-DSP depth + a practice/learning loop (BC-001).
  - **Opportunity:** the playable synth (PRD-002) is momentary — no way to revisit, compare, or build on what was played.
    - **Solution A — capture & *replay*** (shipped MVP): record a Take, hear it back, re-attempt → experiment **OQ-1** (does replay-for-improvement actually fire?).
    - **Solution B — capture & *export*** (deferred, US-13): record a Take, save it as WAV/SMF to keep or share → experiment **OQ-2** (is the inability to export a felt blocker?).

The two solutions sit on the same opportunity and are tested in parallel against the same outcome
(Torres: compare solutions, don't validate just one). The MVP committed to Solution A first; OQ-1/OQ-2
exist precisely to check that was the right branch — not to confirm it after the fact.

**Glossary.** PRD-003 introduces no new ubiquitous-language terms; it reuses *Recording*, *Take*, and
*Replay* exactly as defined in `docs/CONTEXT.md` (added when the recorder shipped). No glossary change.

**Evidence in hand.**
- PR #1 (commit 6c9d383): the MVP is shipped and CI-green. ADR-0002 records the architecture and
  its accepted costs. DESIGN-001 is the post-hoc UX/a11y review with 10 ranked gaps.
- The feature works (Feasibility: validated). What is not yet observed is whether it is used.

**Unvalidated assumptions.**

| # | Assumption | Discovery activity |
|---|---|---|
| OQ-1 | Replay-for-improvement is the real value; the developer will actually replay Takes to inform a second attempt at the same phrase | 3-session usage log: which Takes are replayed vs. immediately deleted; does any Take prompt a re-recording of the same phrase? |
| OQ-2 | localStorage-only persistence is acceptable; the developer does not need to export or share Takes | Ask after 3 sessions: has the inability to export a Take been a blocker or a frustration? If yes, shift Later→Next for US-13. |
| OQ-3 | The delete guard (US-8) should be a toast with undo, not a confirm dialog | Decide during US-8 implementation: a toast is lower friction but requires a timed window; a dialog is higher friction but immediately reversible. Both resolve OQ-3. |
| OQ-4 | `setTimeout`-based replay jitter is inaudible on Takes up to ~3 minutes | Manual check: record a metronomic phrase, replay it, listen for drift. If drift is audible, escalate to a sample-clock scheduler ADR. |

---

## Links

- Business case: `docs/product/business-cases/BC-001-musicware-learning-daw.md`
- Architecture decisions: `docs/architecture/decisions/ADR-0001-react-tauri-rust-audio-engine.md`,
  `docs/architecture/decisions/ADR-0002-composition-recording-frontend-event-stream.md`
- UX review: `docs/product/design/DESIGN-001-recorder-and-volume.md`
- Related PRDs: PRD-001 (musicware MVP — recording DAW), PRD-002 (playable keyboard synth —
  the instrument the recorder captures)
- Shipped: PR #1, commit 6c9d383 (`feat: composition recorder, replay key-sync, and master volume`)
- Open debt: DEBT-018 (retroactive discovery, this document), DEBT-019 (delete guard),
  DEBT-020 (a11y/UX backlog: progress, rename, focus, contrast), DEBT-021 (C4 diagram refresh)
- Tracker issues: local checklist above (tracker.mode = local)
