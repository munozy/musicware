# Spike 0 — MVP UI sketch (throwaway)

> Throwaway feasibility/usability spike for [BC-001](../../docs/product/business-cases/BC-001-musicware-learning-daw.md).
> Brief: [POC-002](../../docs/product/design/POC-002-spike-0-ui-sketch.md). **Not a design spec.**

## Purpose
Before chasing latency numbers, confirm the MVP UI is even drawable at the locked scope
(Norman/Nielsen — *prototype to learn*). A low-fidelity wireframe of the whole MVP surface in one screen.

## Open it
```sh
open prototypes/spike-0-ui-sketch/index.html
```
No build, no dependencies — a single self-contained HTML file.

## What it shows (mapped to the glossary)
- **transport** bar: record / play / stop, time display, loop toggle, BPM, samplerate/buffer.
- 4 **tracks**, each with record-arm / mute / solo, a **gain** fader and a **pan** knob.
- a **clip** on a track, a **region** + **loop** highlighted over bars 1–4, a playhead.
- a master strip with **Export mixdown (WAV)**.

## How to use it
React to it, don't polish it. Ask: is this buildable in React at MVP scope? What's missing,
what's overkill? Jot answers in the POC-002 brief's "What we learned", then **throw this away** —
it exists to be reacted to, not to become the real UI.
