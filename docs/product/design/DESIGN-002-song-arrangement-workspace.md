# DESIGN-002 — UX Design: Song Arrangement Workspace

> Owner: moonozy-designer. Artefact type: UX design note (no PoC yet). Covers the planned
> Song Arrangement feature: a multi-track timeline for arranging saved keyboard compositions
> (Recordings) into complete songs.
> Date: 2026-06-25.

---

## 1. Workspace name recommendation

**Recommended name: "Song"**

Rationale: The existing shell already owns the word "Studio" through its full-screen GarageBand-style
layout. "Composer" overlaps conceptually with the user (they are the composer). "Timeline" is a correct
technical term but opaque to a beginner who has never used a DAW. "Song Arrangement" as a surface
label is too long and production-facing.

"Song" is the single word that captures the user's actual goal: "I want to make a song." It is
conversational, safe for every age, and distinct from every existing surface in the app. It pairs
naturally with the existing sidebar label for saved Recordings, and it makes the mode toggle read as a
simple creative direction choice: **Play** vs. **Song**.

### UI concept: mode toggle, not a new tab bar

The shell must not grow a full tab bar that fights with the topbar. Instead a two-segment toggle
(pill-shaped, inline in the topbar, centered) switches the entire `<main>` region between the two
creative modes:

```
[ Play  |  Song ]
```

- **Play mode** (current default): visualizer + stage + docked keyboard. No change to existing layout.
- **Song mode**: arrangement workspace fills the `<main>` + `<footer>` area; the keyboard dock is
  hidden (it would interfere with timeline scroll).

The toggle uses `aria-pressed` semantics and keyboard-navigable (Left/Right arrow keys within the
group). The active segment has a glass-highlight fill; inactive is subdued. Switching modes preserves
application state in both directions (a recording in progress blocks the switch with a tooltip:
"Stop recording first").

---

## 2. Wireframe descriptions

### 2.1 Overall arrangement workspace layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  [brand]        [ Play | Song ]          [vol] [tempo: 120 ♩]        │
├─────────────────────┬────────────────────────────────────────────────────────┤
│                     │  TRANSPORT BAR                                         │
│  CLIP SHELF         │  [◀◀] [▶] [■] [●]   0:00.000  [LOOP ⌀]  [EXPORT]    │
│  ─────────────────  ├──┬─────────────────────────────────────────────────────┤
│  [+ New Recording]  │  │ RULER  |  1       2       3       4       5        │
│                     │  │        ├────────────────────────────────────────────│
│  Saved recordings   │  │ SECTION BAND (color-coded: Intro / Verse / …)      │
│  as draggable cards:│  ├──────────────────────────────────────────────────── │
│                     │T1│ Track 1  ║▓▓▓[Clip A]▓▓▓▓▓║  [Clip B]  ║          │
│  ┌──────────────┐   │  ├────────────────────────────────────────────────────┤│
│  │ 🎹 Riff 1   │   │T2│ Track 2  ║         [Clip C]║  [Clip C]  ║          ││
│  │ ·· ·  ··    │   │  ├────────────────────────────────────────────────────┤│
│  └──────────────┘   │T3│ Track 3  ║                              ║          ││
│  ┌──────────────┐   │  ├────────────────────────────────────────────────────┤│
│  │ 🎹 Chorus   │   │  │ [+ Add track]                                       ││
│  │ · ·· · ·    │   │  │                                                     ││
│  └──────────────┘   │  │                                                     ││
│                     │  │                                                     ││
│  ─────────────────  │  │                                                     ││
│  [Use template ▼]   │  │                                                     ││
└─────────────────────┴──┴─────────────────────────────────────────────────────┘
```

**Zones:**

| Zone | Purpose |
|------|---------|
| Clip Shelf (left panel, ~220 px) | Scrollable list of all saved Recordings as drag sources; a search/filter field at top; "+ New Recording" shortcut that jumps to Play mode |
| Transport bar (above ruler) | Play/Stop/Record/Rewind buttons + elapsed time display + Tempo input + Loop toggle + "Finish my song" (audio export disabled/"coming soon" in V1 — PRD-004 US-38) |
| Ruler | Bar/beat numbers with playhead (vertical red line that scrubs on click/drag) |
| Section band | A thin colored strip just below the ruler showing named song sections (Tier 1 if a template is chosen; editable in Tier 2) |
| Track lanes | Horizontal lanes; the track header is the leftmost ~180 px per lane, the rest is the clip area |
| "+ Add track" button | Pinned below the last track lane; always visible |

### 2.2 Track header

```
┌─────────────────────────────────────┐
│ ● [color swatch]  Melody     [⋮]    │  ← name (click to rename, pencil icon visible)
│ [M]  [S]   ══════●══════ 80%  ◈     │  ← Mute · Solo · Volume slider · Pan (Tier 1: M/S only)
└─────────────────────────────────────┘
```

- Color swatch: click to pick from 8 preset track colors (matches clip block color). Non-decorative:
  color differentiates tracks at a glance; pairs with shape/pattern for WCAG 1.4.1.
- Track name: static pencil icon always visible (lesson from DESIGN-001 gap #3 on rename affordance).
- **[M] Mute** / **[S] Solo**: large touch targets (44 × 28 dp), toggle buttons with `aria-pressed`.
  Active Mute fades the track header visually; active Solo dims all other tracks.
- Volume slider + % readout: Tier 1 visible; volume knob (pan) visible in Tier 2.
- **[⋮] Track menu**: overflow menu for Tier 2+ actions (Duplicate track, Delete track, Color).

### 2.3 Clip on the timeline

```
┌─[resize◀]──────────────────────────────────────[resize▶]─┐
│  Riff 1                                          [⟳ loop] │
│  · ·  ·· ·  · ·  ··  ·   ·· ·  · ·  ··  ·   ·· ·       │
│  (mini note-dot pattern, left-to-right, pitch = vertical) │
└───────────────────────────────────────────────────────────┘
```

- **Block shape**: rounded rectangle, filled with the track color at ~40% opacity against the dark
  glass; a solid 2 px top border in the track color (high contrast marker).
- **Note-dot mini-preview**: dots placed proportionally along the clip width (time axis) and
  vertically within a compressed pitch range (no labels). They give a visual fingerprint of the
  melody without requiring music-reading ability. Dots are `aria-hidden`; the clip's accessible
  name is "Clip: [Recording name], [duration], on [track name]".
- **Clip label**: top-left, white text, 12 px, truncated with ellipsis.
- **Resize handles**: shown only on hover/focus. Left handle (◀) shifts start; right handle (▶)
  shifts end. Both are 8 px wide touch targets with a gripper cursor.
- **Loop badge [⟳]**: appears top-right on hover in Tier 2. Click toggles loop mode on the clip.
- **Selected state**: 2 px white border + subtle drop shadow. Arrow keys nudge the clip one bar
  left/right when selected.
- **Duplicate affordance**: Alt+drag creates a copy; cursor shows a + badge during Alt hold.

### 2.4 Song-structure template picker

Accessed from the Clip Shelf footer: **"Use template ▼"** button opens a compact popover (not a
modal, to preserve spatial context):

```
┌───────────────────────────────────┐
│  Start from a song structure      │
│                                   │
│  ○ Electronic                     │
│    Intro · Build · Drop ·         │
│    Breakdown · Outro              │
│                                   │
│  ○ Rock                           │
│    Intro · Verse · Chorus ·       │
│    Bridge · Solo · Outro          │
│                                   │
│  ○ Cinematic                      │
│    Intro · Tension · Climax ·     │
│    Resolution                     │
│                                   │
│  ○ Start blank                    │
│                                   │
│  [Apply]  [Cancel]                │
└───────────────────────────────────┘
```

Applying a template:
1. Paints the section band on the ruler with proportional colored blocks (each section a distinct
   hue, labeled in white text inside the block if wide enough, else a tooltip on hover).
2. Creates one empty track per section as a guide (the user can delete them).
3. Does NOT auto-populate clips — the user drags from the shelf. This preserves creative agency.

Section colors are consistent per template (not user-defined at Tier 1): Electronic uses blues/purples,
Rock uses reds/oranges, Cinematic uses greens/teals. Colors meet WCAG 3:1 non-text contrast against the
dark ruler background. Color is supplemented by the text label (not the sole differentiator).

---

## 3. Timeline interaction model

Every interaction is described from the beginner's felt experience, with the cursor/haptic affordance
and feedback it produces.

### 3.1 Drag-drop clip from shelf to timeline

1. User picks up a Recording card from the shelf. The card lifts with a subtle scale (1.0 → 1.03)
   and a drop-shadow, indicating it is being held. Other cards fade slightly to reduce visual noise.
2. As the card crosses the boundary into the timeline area, it transforms into a clip-shaped ghost
   (correct width proportional to Recording duration, in the target track's color).
3. The ghost snaps to the nearest bar boundary (snap-to-grid is on by default). A faint vertical
   snap line flashes at the snap target (50 ms, respects `prefers-reduced-motion`: no animation,
   just a static highlight).
4. The track lane under the cursor highlights (a 1 px inset border glow) to confirm the drop target.
5. Drop: the clip appears with a brief scale-in (200 ms ease-out). If `prefers-reduced-motion` is
   set, the clip appears immediately with no animation.
6. If the user drops the clip onto an occupied region, the ghost turns orange and shows a tooltip
   "This spot is taken — move or trim the existing clip." No silent overwrites.

### 3.2 Move an existing clip

- Hover the clip body: cursor becomes a 4-directional move cursor. A grab handle bar (3 horizontal
  dots, subtle) appears at the clip's top center.
- Click and drag: the clip lifts (same lift effect as 3.1). Horizontal drag only — clips cannot jump
  tracks by drag (track assignment is explicit; Tier 2 adds a "Move to track" option in the clip's
  context menu to avoid accidental track reassignment by a beginner).
- Snap feedback: identical to 3.1.
- Release: clip settles. Undo available via Cmd/Ctrl+Z (toast: "Moved clip. Undo?").

### 3.3 Copy / duplicate a clip

- **Alt+drag**: cursor gains a + badge. A copy is created at the drop point; original stays.
- **Right-click clip → Duplicate**: keyboard-accessible equivalent. Duplicate appears immediately
  after the original (one bar gap).
- Toast: "Clip duplicated. Undo?"

### 3.4 Resize a clip

- Hover near the left or right edge (within 12 px): cursor becomes a horizontal resize cursor
  (col-resize). The edge highlights with a brighter color.
- Drag to resize. The clip's note-dot preview reflows proportionally (notes outside the new bounds
  are clipped with a fade gradient, not hidden abruptly).
- Snaps to grid. A small tooltip near the handle shows the new duration in beats (e.g. "4 bars").
- Resizing past the original Recording's length is blocked with a soft stop (the handle bounces
  back); a tooltip explains "Clip can't be longer than the recording."

### 3.5 Split a clip

- Tier 2. Right-click at the desired split point on the clip → "Split here". Or: position the
  playhead over the clip and press S (keyboard shortcut shown in the context menu).
- The clip splits into two with a brief flash at the cut line.
- Each half is independently movable. Toast: "Clip split. Undo?"

### 3.6 Merge clips (Join)

- Tier 2. Multi-select two adjacent clips on the same track (Shift+click, or drag a selection
  rectangle in the ruler area), then right-click → "Join clips".
- Only adjacent, same-track clips can be joined. If gaps exist between them, a warning explains
  "There's a gap between these clips. Joining will add silence."

### 3.7 Loop a clip

- Tier 2. Hover the clip → loop badge [⟳] appears top-right. Click to enable: the clip extends
  visually to the right with a repeating ghost (hatched pattern, same note dots, lower opacity).
  A resize handle on the ghost controls how many loops.
- Visual metaphor: like a rubber band stretching right.

### 3.8 Quantize

- Tier 2. Right-click clip → "Quantize notes". A simple selector appears: 1/4, 1/8, 1/16 note
  grid. The note-dot preview updates live as the user hovers the options (preview-before-commit).
- Applies to the Recording's symbolic events; non-destructive (original is preserved, quantization
  is a render-time parameter on the clip).

### 3.9 Snap-to-grid

- On by default. A small "Snap ▾" button in the transport bar shows the active grid (e.g. "1 bar").
  Click to cycle: Off → 1/2 bar → 1 bar → 2 bars, or choose from a dropdown.
- When snap is off, a subtle warning badge on the Snap button signals "free positioning".
- Fine-positioning: with snap on, holding Cmd/Ctrl while dragging temporarily suspends snap for
  that drag only (modifier shown in a tooltip on first use).

---

## 4. Progressive disclosure plan

### Tier 1 — Beginner default (zero music-production knowledge assumed)

Available on first launch. All Tier 2 and 3 affordances are hidden.

**What is visible:**
- Clip shelf with saved Recordings as drag cards.
- Timeline with 1 default track pre-created.
- Track header: color swatch, name, Mute, Solo.
- Transport: Play, Stop, Rewind to start, elapsed time, Tempo (BPM) input (labeled "Speed" with
  a ? tooltip explaining BPM).
- Template picker ("Start from a song structure").
- Snap-to-grid on by default, no snap controls visible.
- Clip interactions: drag from shelf, move, delete (right-click → Remove, or select + Backspace).
- "+ Add track" button.
- "Finish my song" button — completing a song *is* the primary goal, so the affordance is
  present at Tier 1. **But audio export is out of scope for V1** (PRD-004 non-goal #2 / US-38 —
  it needs the future DSP graph + an offline renderer, see ADR-0007). So in V1 this button opens
  a share sheet for the *arrangement* (play it in-app; save/share the project), and a clearly
  labeled **"Save as audio file (coming soon)"** item is shown **disabled** — discoverable, but
  honestly gated, never a control that produces nothing.

**What is hidden:**
- Volume/pan per track (master volume already exists in the topbar).
- Loop clip, Resize clip handles (appear only on hover once the user has placed their first clip —
  revealed by onboarding tooltip).
- Split, Merge, Quantize.
- Automation lanes.
- Tempo map / time signature changes.

**Nielsen heuristics addressed:**
- H1 (visibility): playhead position, transport state, section labels all visible.
- H6 (recognition): template picker, drag-from-shelf, color-coded tracks — no recall of DAW
  concepts needed.
- H8 (aesthetic): clutter-free; pro controls hidden.

**WCAG at Tier 1:**
- All interactive elements ≥ 44 × 44 dp touch target.
- Color + shape used together (no color-only differentiation).
- Full keyboard navigation: Tab through transport, track headers, clips (clips are focusable
  elements within the track lane, arrow keys nudge).
- `prefers-reduced-motion`: all timeline animations (clip drop, playhead move) respect the flag.
- Screen-reader announcements: clip drop announces "Riff 1 placed on Track 1 at bar 3";
  playback announces "Playing" / "Stopped" via `aria-live="polite"`.

### Tier 2 — Intermediate (unlocked after the user places their first 3 clips)

A gentle prompt: "You're building something. Want more controls?" with [Yes, show me] / [Not yet].
The choice is stored in `localStorage`; not shown again. Tier 2 adds:

- Track volume slider + pan knob (track header expands).
- Clip resize handles (appear on hover for all clips).
- Clip loop toggle badge.
- Split and Merge in context menu.
- Quantize in context menu.
- Snap controls (grid picker in transport bar).
- Loop region (drag the ruler to define a loop region; Loop button in transport becomes active).

### Tier 3 — Advanced (explicitly unlocked via Settings → "Advanced mode")

Not auto-revealed. Requires intentional opt-in. Adds:

- Automation lanes (per-track volume/pan over time; shown as a sub-lane below each track, toggled
  by an expand arrow in the track header).
- Per-clip effects chain (reverb, delay — opens a floating panel).
- Time signature and tempo map.
- MIDI export of individual tracks.
- Fine snap resolution (1/16 note, 1/32 note).

---

## 5. Song-structure visual helpers and templates

### Section band rendering

The section band occupies an 18 px strip between the ruler and the first track lane. Each section is
a colored block:

```
│ RULER  │ 1     2     3     4     5     6     7     8  …   16  │
│ SECTIONS│[─── Intro ───][──────── Verse ────────][── Chorus ──│
```

- Sections are labeled in white 11 px text inside the block; if the block is too narrow (< 60 px),
  the label is replaced by a dot indicator and a tooltip on hover.
- Section dividers are draggable (left/right) in Tier 2 to resize sections.
- Clicking a section selects it (background highlight) and shows the section name in a small pill
  above: "Verse — bars 5–12 [rename]".
- Double-clicking a section enters rename mode (same pencil-always-visible pattern from DESIGN-001).

### Template: Electronic

| Section | Color | Default length |
|---------|-------|---------------|
| Intro | Deep indigo #3D2B8E | 8 bars |
| Build | Blue-violet #5B4ACF | 8 bars |
| Drop | Electric purple #9B30FF | 16 bars |
| Breakdown | Muted lavender #6B5A9E | 8 bars |
| Outro | Deep indigo #3D2B8E | 8 bars |

### Template: Rock

| Section | Color | Default length |
|---------|-------|---------------|
| Intro | Burnt orange #C4521A | 4 bars |
| Verse | Rust red #A83220 | 8 bars |
| Chorus | Crimson #D42B2B | 8 bars |
| Bridge | Amber #C97D14 | 4 bars |
| Solo | Gold #D4A817 | 4 bars |
| Outro | Burnt orange #C4521A | 4 bars |

### Template: Cinematic

| Section | Color | Default length |
|---------|-------|---------------|
| Intro | Forest green #2A6B3C | 8 bars |
| Tension | Teal #1A7A6E | 16 bars |
| Climax | Jade #0FA86A | 8 bars |
| Resolution | Forest green #2A6B3C | 8 bars |

### Beginner workflow with a template

1. User opens Song mode for the first time. An empty timeline with a single track and no sections.
2. A non-blocking coach-mark (tooltip overlay, dismissible) points to "Start from a song structure"
   in the shelf footer: "Pick a template to get a head start."
3. User picks "Rock". Template applies: the ruler fills with colored section blocks; four empty
   tracks appear, named "Intro", "Verse/Chorus", "Bridge", "Outro" (fewer than sections, to avoid
   overwhelming). A toast: "Rock structure applied. Drag your recordings into each section."
4. User sees the Clip Shelf on the left, recognizes their saved recordings, drags them into the
   appropriate colored sections.
5. The visual alignment between shelf card colors (neutral gray) and section band colors (track
   color from step 3) helps the user place clips "in" the right part of the song.
6. Hitting Play shows the playhead moving through sections in real time, with the current section
   name displayed in the transport bar next to the time counter.

---

## 6. AI assist surface

The AI assist (moonozy agents) surfaces in two locations, always non-intrusive, always
explained in plain language.

### 6.1 Shelf: "Suggest what to place next"

A small sparkle button (✦, labeled "Suggest" on hover, always labeled on focus) appears at the
bottom of the Clip Shelf panel. It becomes active (glows) when at least one clip has been placed.

```
Clip Shelf
──────────
[Riff 1]
[Chorus]
[Bridge]

──────────
✦ Suggest    ← always visible, not animated unless active
```

Clicking it opens a compact non-modal drawer (slides in from the right of the shelf, not a page
overlay) with plain-language output:

```
┌─────────────────────────────────────────────┐
│ ✦ Song suggestion                           │
│                                             │
│ Your Drop section (bars 9–24) is empty.     │
│ "Riff 1" has a strong beat pattern —        │
│ it could work well there.                   │
│                                             │
│ [Place it for me]  [Dismiss]                │
└─────────────────────────────────────────────┘
```

- "Place it for me" does a visible, animated placement (the user sees exactly what happened and
  can immediately undo it). It is not silent automation.
- The suggestion is a single, concrete recommendation — never a list of options that requires a
  decision. The AI absorbs the decision-making overhead; the user retains the veto.
- If the user dismisses, the suggestion does not reappear for the same slot in the same session.

### 6.2 Transport: "Complete this song" (Tier 2)

Once the user has filled at least half the song sections, a secondary button "✦ Finish the song"
appears near the Export button in the transport bar. Clicking it opens the same non-modal drawer
with a suggestion for the unfilled sections.

### AI philosophy in the UI

- Suggestions use "you could" / "this might work" language, not imperative commands.
- The AI affordance is a sparkle (✦) consistently — one icon, one meaning, app-wide.
- No AI action is irreversible without user confirmation. Every AI placement is immediately
  undoable.
- The AI drawer is dismissed by Escape and does not trap focus (WCAG 2.4.11 — focus not obscured).
- The "Suggest" button has `aria-label="Get a song suggestion from AI"`. The drawer has
  `role="dialog"` with a proper heading and `aria-describedby`.

---

## 7. Nielsen 10-heuristic pass (arrangement workspace)

| Heuristic | Assessment |
|-----------|-----------|
| H1 Visibility of system status | Playhead position, section name in transport, track mute/solo state, recording indicator from Play mode — all surfaced. Gap: no visual indication when Export is processing (future: progress spinner). |
| H2 Match between system and real world | "Song", "Track", "Section" over "Timeline", "Region", "Automation". Tempo labeled "Speed" at Tier 1. |
| H3 User control and freedom | Undo/redo throughout. Drag does not auto-destroy existing clips. Template application shows a confirmation toast with Undo. |
| H4 Consistency and standards | Mute/Solo and color use consistent with GarageBand conventions. Playhead interaction is standard (click ruler to seek). |
| H5 Error prevention | Snap-to-grid on by default prevents misaligned clips. Drop-on-occupied zone shows warning before placement. Resize blocked beyond source length. |
| H6 Recognition over recall | Clip shelf is always visible. Note-dot previews make Recordings recognizable without reading names. Templates pre-fill section labels. |
| H7 Flexibility and efficiency | Keyboard shortcuts (Space=play, R=record, Cmd+Z=undo, S=split in Tier 2). Tier 2 snap override (Cmd+drag). |
| H8 Aesthetic and minimalist design | Tier 1 hides all pro controls. Track header is compact. Clip body carries only label + note dots. |
| H9 Error recovery | Toast + undo on every destructive or placement action. Clear error state on invalid drop (orange ghost + tooltip). |
| H10 Help and documentation | Coach-marks on first Song mode entry. Tooltips on BPM, snap, AI suggest. No modal "welcome" interruption. |

---

## 8. Accessibility summary

| Concern | Resolution |
|---------|-----------|
| Keyboard-navigable timeline | Clips are `role="application"` elements inside a `role="grid"` (track = row, bar = column). Arrow keys navigate; Enter opens clip context menu; Space selects. |
| Clip placement without drag | "Place on track" button in the shelf card context menu (right-click or keyboard menu key) places the clip at the current playhead position on the focused track. |
| Screen reader clip announcement | `aria-label="[Recording name], [duration] bars, Track [n], bar [n]"` |
| Color-only differentiation | Section colors are always accompanied by text labels. Track colors are supplemented by track name. Clip type does not rely on color alone. |
| Focus trap in template picker | Popover traps focus; Escape closes and returns focus to the trigger button. |
| Reduced motion | Playhead animation, clip drop animation, and section band paint are all gated on `prefers-reduced-motion: no-preference`. Functional alternatives (immediate placement, static playhead line) provided when reduced motion is active. |
| WCAG contrast | All text on dark glass must meet 4.5:1 (normal) / 3:1 (large). Section band text (11 px white on colored block): enforced by minimum block hue lightness threshold. Disabled track controls: opacity ≥ 0.5 plus a thin border (lesson from DESIGN-001 gap #5). |

---

## 9. Top UX risks

| Rank | Risk | Mitigation |
|------|------|-----------|
| 1 | **Beginner does not know what "bar" or "beat" means.** Ruler labeled in bar numbers may be meaningless. | Label ruler in seconds at Tier 1 (switch to bars in Tier 2). Add a tooltip on the ruler explaining "Each block is a few seconds of music." |
| 2 | **Clip shelf is empty on first use** (no saved recordings). Arrangement mode is useless without recordings; user is confused. | If the shelf has < 1 recording, Song mode shows an interstitial: "You haven't recorded anything yet. [Go record →]" instead of an empty timeline. |
| 3 | **Drag-to-timeline is not discoverable on touch / trackpad without pointer affordance.** Users may not know shelf cards are draggable. | Static "drag me" visual treatment on shelf cards (a subtle dotted border + drag icon). On first Song mode entry, a one-time coach-mark pulse on the first shelf card. |

---

## 10. Ranked design gaps (open before implementation)

| Rank | Gap | Severity |
|------|-----|---------|
| 1 | Tempo representation: beginners do not understand BPM. Label and affordance design needed. | High |
| 2 | Export format and feedback: what does the user receive? A WAV? An in-app player link? Flow undefined. | High |
| 3 | Multi-track playback of symbolic clips (Recordings) requires the Rust engine to schedule multiple event streams simultaneously. Validate feasibility before finalizing the track count limit. | High (architecture risk — requires handoff) |
| 4 | Conflict resolution when two clips overlap during drag (overlap prevention vs. stacking). | Moderate |
| 5 | Maximum song length: ruler must have a defined right edge or infinite scroll. Beginners need a nudge ("Your song is about 2 minutes — that's a great length!"). | Moderate |
| 6 | Undo history depth: how many undo steps? localStorage size constraints for symbolic events. | Low |

---

## Links

PRD: pending · ADR: pending (multi-track scheduling risk requires ADR) · Related: DESIGN-001, CONTEXT.md
