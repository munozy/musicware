# spike-4-arrangement-workspace

**Throwaway PoC — POC-004 / DISCOVERY-001 OQ-3**

A single self-contained HTML file that lets you run the DISCOVERY-001 OQ-3 usability session.
No build step, no server, no dependencies. Open `index.html` directly in any modern browser.

---

## What this is

An interactive Brick Stack prototype for de-risking the arrangement workspace UX
(DESIGN-002) before committing to the full Solution A build (PRD-004).

The prototype is **throwaway by design** — it lives here and is never copied into production
source. Graduating to production requires a linked PRD + ADR (see POC-004 brief).

**What it tests:** whether a zero-DAW beginner can reach first-combined-playback unaided
(P1), move a clip after hearing it (P2), and do both in under 5 minutes (P3) — the three
binding gate conditions in DISCOVERY-001 §5.

**What it does NOT test:** the real Rust/Tauri engine, actual Recording data, export,
AI assist, volume/pan, section templates, or any Tier-2/3 feature. All audio is synthesized
directly in Web Audio API from hardcoded symbolic note events.

---

## How to open

```
open prototypes/spike-4-arrangement-workspace/index.html
```

Or double-click `index.html` in Finder / Explorer. No localhost needed.

Tested in: Chrome 124+, Firefox 125+, Safari 17+. Requires Web Audio API support.

---

## OQ-3 Session Script

Run this script verbatim. The order matters: the want-probe MUST come before the participant
sees the prototype.

### Before opening the prototype

**Step 0 — Fill the want-probe field (facilitator only, before the participant sees anything):**
Open the metrics panel (top-left, "Gate Metrics") by clicking the ▼ toggle button.
In the "Unprimed want-probe answer" textarea, record what the participant says in Step 1 below.
Collapse the panel again (click ▲) before handing the screen to the participant.
The panel is collapsed by default on load, so the want-probe categories are not visible
to the participant; only expand it while the participant is NOT watching.

**Step 1 — Unprimed want-probe (ask this BEFORE showing the prototype):**

> "You've recorded a few musical ideas on your phone or a computer.
> What would you want to do with them next?"

Listen for whether *combining / arranging them into a song* surfaces spontaneously.
Do not prompt or explain. Record the verbatim answer and select the quick-tag
(combine/arrange | export/share | keep-playing | other) in the metrics panel.
This is the demand signal — it is only valid if asked before the participant sees
the arrangement surface.

### Opening the prototype

Hand the screen to the participant (or share screen). Say:

> "You have some musical ideas saved — these coloured cards at the bottom.
> Make a short song from them."

**No further instruction.** If the participant asks what to do, say:
> "What would you try first?"

Encourage think-aloud if the participant is comfortable, but do not narrate the UI.

### Observe (facilitator notes)

| Signal | What to watch |
|--------|--------------|
| P1 | Does the participant reach playback with >=2 bricks on different rows without help? |
| P2 | After the first playback, does the participant move or reposition a clip? |
| P3 | The metrics panel P1/P3 timer turns green when P1 is met; red if it crosses 5 min |
| First hesitation | Where does the participant pause or express confusion? Note the exact moment |
| P4 (corroboration) | Does the participant make an unprompted comment that the loop feels inviting? |

### After the session

Click "Copy session JSON" or "Download JSON" in the metrics panel to capture the gate
evidence (P1/P2/P3 status, timing, clips placed, want-probe answer) and paste it into
DISCOVERY-001 §5.

### 15-minute retrospective (immediately after)

Run prompts P-R1 through P-R6 from DISCOVERY-001 §6:

- **P-R1:** "Walk me through what you just did, step by step, from the moment you opened it."
- **P-R2:** "What was the first thing you tried to do? What happened?"
- **P-R3:** "After you played it the first time — what went through your mind? Did you want
  to change anything?"
- **P-R4:** "Was there any moment where you weren't sure what to do, or something didn't
  work as expected?"
- **P-R5:** "If this were in the real app — would you open it next time you recorded ideas?
  What would you use it for?"
- **P-R6:** "Did any of the bricks feel like they belonged together? Did any feel wrong?
  What made you decide where to put each one?"

---

## Gate pass criteria (pre-committed, DISCOVERY-001 §5)

| # | Criterion | Binding? |
|---|-----------|---------|
| P1 | First combined playback reached without verbal help | binding |
| P2 | At least one clip moved after first playback | binding |
| P3 | P1 reached in under 5 minutes | binding |
| P4 | Unprompted engagement/want comment | corroboration only |

All three binding criteria met → Gate A (proceed to PRD-004 Solution A build).
P1 or P3 not met → Gate B (revise DESIGN-002 before building).

---

## Prototype feature map

| Spec item | Implemented |
|-----------|-------------|
| 3-lane stage, dark-glass tokens | Yes |
| 4+1 brick tray (Drums/Bass/Melody/Chords/Arp) | Yes (5 bricks) |
| Drag from tray to lane | Yes |
| First brick auto-snaps to col 0 | Yes |
| Same-lane overlap refused (orange ghost + tooltip) | Yes |
| Cross-lane overlap gold glow + "will play together" | Yes |
| Play button pulse when combine is possible (pointer + keyboard) | Yes |
| Coach line after first drop | Yes |
| Post-play nudge (move after hearing) | Yes |
| Empty-state hint ("Drag a card up here to start your song") | Yes |
| Persistent first-card border cue; hidden after first drop | Yes |
| Web Audio playback (drums/bass/melody/chords/arp timbres) | Yes |
| Playhead driven from audioCtx.currentTime | Yes |
| Stop with 20ms anti-click ramp via shared master GainNode | Yes |
| Rewind to 0 | Yes |
| Keyboard placement fallback (Enter to select + 1/2/3 to drop) | Yes |
| Space triggers Play/Stop globally (not Enter; focus-independent) | Yes |
| Visible 1/2/3 key hints on lane headers + card hint when selected | Yes |
| Arrow-key clip nudge | Yes |
| Visible × delete button on each placed clip (hover + focus) | Yes |
| Right-click to remove clip | Yes |
| Focus moved to newly placed clip + announcement | Yes |
| Single-level Cmd/Ctrl+Z undo (place/move/delete) + toast | Yes |
| Distinct row accent colors (violet / teal / rose) | Yes |
| Clip playback highlight + "Now playing: X + Y" in transport | Yes |
| aria-live announcements | Yes |
| Debounced aria-live on refused drop + keyboard placement shift | Yes |
| prefers-reduced-motion respected | Yes |
| P1/P3 timer anchored to page load; time-to-first-action sub-metric | Yes |
| Gate metrics panel collapsed by default (want-probe hidden from participant) | Yes |
| Gate metrics panel (P1/P2/P3 + want-probe + JSON export) | Yes |
| Session JSON includes pageLoad anchor + elapsed fields | Yes |
| Section templates | **Not included** — descoped (Tier-1 cut per spec). OQ-3's template-learnability sub-question is NOT covered by this prototype run. Record this gap in session notes. |
| AI assist / volume/pan | Not included (Tier-1 cut per spec) |
