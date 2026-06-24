# DESIGN-001 — UX Review: Composition Recorder + Master Volume

> Owner: moonozy-designer. Artefact type: UX review (not a PoC). Covers the increment
> that landed `src/Recorder.tsx`, `src/VolumeControl.tsx`, and their CSS/test counterparts.
> Date: 2026-06-24.

---

## 1. User tasks this increment serves

| # | Literal ask | Entry point |
|---|-------------|-------------|
| T1 | Record a composition (multiple takes in one session) | Record button → play keyboard → stop |
| T2 | Replay a saved take | Play button in take row |
| T3 | Rename a take | Click the take name |
| T4 | Delete a take | Delete (✕) button in take row |
| T5 | Raise or lower master output level | -/slider/+ in VolumeControl |
| T6 | Set a precise volume | Drag or arrow-key the slider |
| T7 | Persist volume across sessions | (automatic, localStorage) |

---

## 2. Nielsen 10-heuristic pass

Only the heuristics that surface meaningful signal are included.

### H1 — Visibility of system status

**Recorder (good).** The armed button fills red and its label reads "Stop · m:ss"; the live counter satisfies the "recording in progress" status need. An `aria-live="polite"` region broadcasts the count to screen readers.

**Gap — no playback progress (moderate).** During replay the row gains a blue border (`rec-row.playing`) but there is no elapsed/remaining indicator or progress bar. For a 3-minute take the user cannot tell whether playback is at second 3 or second 177. The play button flip to ■ signals *that* something is playing, not *where*.

**Gap — no keyboard visual when recording (minor).** The keyboard has no armed cue (e.g. a red outline) to remind the user that keystrokes are being captured. A user who tabs away from the recorder area and returns may not know recording is live.

### H3 — User control and freedom

**Gap — no delete confirmation (high).** Clicking ✕ immediately and irrecoverably removes a take. No undo, no undo toast, no confirm dialog. For a long composition this is a hard loss. This is the highest-severity gap in the increment.

**Cancel during rename (good).** Escape restores the original name and `onBlur` commits, so the user can exit both ways. Focus management is correct (`autoFocus` on the edit input).

### H4 — Consistency and standards

**Gap — preset highlight does not track playback (low).** When a take that used the Organ preset is replayed, the PresetSelector still shows whatever preset is currently active, not the one being heard. The audio correctly restores the preset (a `preset` event is in the recorded event log), but the button highlight does not follow. This diverges from the DAW convention of "what you hear = what the controls show".

### H5 — Error prevention

**Gap — delete has no guard (high).** Covered under H3. From an error-prevention lens the concern is the same: a destructive, irreversible action with a single unconfirmed click in a target that is 28 × 28 px (`.rec-del` inherits `0.25em 0.6em` padding on a ✕ glyph).

**Volume limits (good).** The -/+ buttons are `disabled` at 0 and 1 respectively; `clamp01` prevents slider drift beyond bounds; `toFixed(2)` prevents float accumulation. The disabled state is styled with `opacity: 0.4` which is visible but borderline for contrast (see A11y section).

### H6 — Recognition rather than recall

**Gap — rename affordance is hover-only (moderate).** The take name is a `<button>` with `title="Click to rename"` and a `.rec-name:hover { border-color: #ccc }` reveal. There is no static visual cue (no pencil icon, no dashed underline, no edit glyph) indicating the name is interactive before hover. Keyboard users and touch users never see this cue. This is a discoverability gap for a feature users are expected to exercise routinely.

### H7 — Flexibility and efficiency of use

**Volume step size (note).** The step buttons move in 10% increments; the slider allows 1% steps. Power users wanting 65% must use the slider; the buttons are a coarse shortcut only. This is intentional and acceptable at MVP, but worth revisiting if precision matters later.

### H9 — Help users recognise, diagnose, and recover from errors

**Gap — rename commit on empty (minor).** If the user clears the name field and presses Enter, `draft.trim()` is empty so the original name is restored (the `else setDraft(rec.name)` branch). This is correct behaviour but silent — there is no feedback that the rename was rejected. A brief inline hint ("Name cannot be empty") would satisfy H9 here.

---

## 3. Accessibility review

### Roles and labels

| Element | Role / label | Verdict |
|---------|-------------|---------|
| `<section>` recorder | `aria-label="Composition recorder"` | Pass |
| Record/Stop button | `aria-pressed={isRecording}`, dynamic `aria-label` | Pass |
| `<span aria-live="polite">` | Announces count + "Recording" state | Pass |
| Play/Stop row button | `aria-label="Play {name}"` / `aria-label="Stop {name}"` | Pass |
| Rename trigger | `aria-label="Rename {name}"`, `title="Click to rename"` | Partial — `title` is not announced by all screen readers; the accessible name is correct but the intent (editable) is not conveyed via role |
| Rename input | `aria-label="New name"`, `autoFocus` | Pass |
| Delete button | `aria-label="Delete {name}"` | Pass — but no confirmation means a single SR keypress is destructive |
| Volume group | `role="group"`, `aria-label="Master volume"` | Pass |
| Volume slider | `type="range"`, `aria-label="Volume level"`, `min`/`max`/`step` | Pass |
| -/+ buttons | `aria-label="Lower/Raise volume"`, `disabled` at limits | Pass |
| Speaker icon | `aria-hidden="true"` | Pass |

### Keyboard operability

- All interactive elements are native `<button>` or `<input>` — reachable by Tab without tabindex hacks.
- Rename inline edit: Enter commits, Escape cancels, focus lands on input via `autoFocus`. Blur commits (good for mouse users; potentially surprising for keyboard users who Tab out expecting a cancel).
- Record/Stop toggle works on Space/Enter (native button behaviour).
- **Gap:** Slider arrow-key increment is 0.01 (the `step` attribute), so moving from 60% to 70% requires 10 keypresses. Consider `step="0.1"` for keyboard use while keeping slider drag at full precision via `step="any"` or a separate `input[type=range]` technique. Low severity.

### Focus management

- Rename entry: `autoFocus` is present — focus is correct on open.
- After committing/cancelling rename, focus is lost (the input unmounts, the name button remounts, but focus is not explicitly restored). The user is dropped to the document body. This is a moderate keyboard/screen-reader annoyance — the user has to Tab back to the take they just renamed.
- After deleting a take, focus similarly drops to the body. If the list still has items, focus should move to the next take (or the Record button if the list empties).

### Colour and contrast

- `.rec-dot` red (`#d11`) on white button background: passes WCAG AA for the non-text indicator.
- `.rec-btn.armed` white text on `#d11`: contrast ratio ~4.7:1 — passes AA (4.5:1 threshold for normal text).
- `.vol-btn:disabled` at `opacity: 0.4` on white: the resulting effective contrast of the "−"/"+" glyphs is approximately 2.1:1 against the background — **fails WCAG AA** (3:1 for large text / UI components). The disabled state communicates "unavailable" correctly, but the low contrast may confuse low-vision users into thinking the button is absent rather than inactive. A note text such as "Min" / "Max" or a tooltip, combined with `opacity: 0.5` (borderline) or a different disabled treatment, would improve this.
- `.rec-name:hover` border `#ccc` on white: 1.6:1 — fine as a hover decoration, not a primary contrast carrier.
- Dark mode rules are present for `.rec-row` and `.rec-name` but not for `.vol-pct` or `.rec-dur` (`#888` on `#2f2f2f` = ~3.8:1 — passes AA for text ≥ 14px; borderline at smaller sizes).

### Mute / 0% affordance

The volume slider reaches 0 and the `-` button is disabled there, which correctly prevents going below 0%. However there is no distinct mute affordance: the speaker icon (`🔊`) does not change when volume is 0 — it does not become a muted speaker (`🔇`). A user who drags to 0 expecting a mute toggle will see no icon feedback that the output is silenced. Severity: low (the % readout is present), but the icon is a missed affordance.

---

## 4. Ranked UX gaps

| Rank | Gap | Heuristic(s) | Severity | Notes |
|------|-----|-------------|----------|-------|
| 1 | **No delete confirmation or undo** — single click irrecoverably removes a take | H3, H5 | **High** | A 2-step confirm ("Delete?" → confirm) or a 5-second undo toast would resolve this. Toast is lower friction. |
| 2 | **No playback progress / playhead** — user cannot tell where in a take playback is | H1 | **Moderate** | A thin progress bar on the row (filled left-to-right over `rec.durationMs`) requires only elapsed-ms tracking already present for recording; low implementation cost. |
| 3 | **Rename affordance is invisible until hover** — no static edit cue; keyboard/touch users never see it | H6 | **Moderate** | Add a persistent pencil icon (aria-hidden, right of name) or a dashed-underline style on `.rec-name`. The `title` tooltip is not a reliable affordance. |
| 4 | **Focus not restored after rename or delete** — keyboard/SR users lose their place in the list | WCAG 2.4.3 | **Moderate** | After commit/cancel, `ref.current?.focus()` on the name button. After delete, focus the next row or the Record button. |
| 5 | **Disabled -/+ buttons fail WCAG contrast (~2.1:1)** | WCAG 1.4.11 | **Moderate** | Raise opacity to at least 0.6 or use a border/text treatment instead of opacity alone for the disabled state. |
| 6 | **Preset button highlight does not reflect playback** — controls lie about what you hear | H4 | **Low** | Requires `useRecorder` to emit a `preset-change` event during playback that PresetSelector can subscribe to. Medium implementation cost. |
| 7 | **No keyboard visual when recording** — user can navigate away without noticing record is live | H1 | **Low** | A red outline or banner on the `.keyboard` element keyed to `isRecording` state passed down from App. |
| 8 | **Speaker icon does not change at 0%** — missed mute affordance | H1, Norman affordance | **Low** | Toggle icon between `🔊` and `🔇` when level is 0. One-liner. |
| 9 | **Rename blur commits silently on empty input** | H9 | **Minor** | Inline `<span role="alert">` under the edit input when draft is empty. |
| 10 | **Slider step is 0.01 for keyboard users** (10 keypresses per 10% step) | H7 | **Minor** | `step="0.1"` on the range input, or an `aria-valuetext` that rounds to 10%. |

---

## 5. Summary for prioritisation

The increment is functionally solid and semantically well-marked. The three gaps that warrant action before broader user exposure are:

1. **Delete guard** (High) — a single unconfirmed click destroys work with no recovery path.
2. **Playback progress** (Moderate) — the transport conveys state but not position; users of long takes are flying blind.
3. **Rename discoverability** (Moderate) — a core workflow is invisible to keyboard and touch users.

Items 4 and 5 (focus restoration, disabled contrast) should be bundled with any accessibility hardening pass. Items 6–10 are backlog candidates.

---

## Links

PRD: pending · ADR: — · Related stories: STORY-K4 (presets), STORY-K5 (chord mapping)
