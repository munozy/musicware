# ADR-0009 — Voice recording: the first audio asset (dual recording model)

- **Status:** Accepted (2026-06-28). Reduced-bar caveat: implemented inline (org API spend limit blocks the
  adversarial review + Council); a re-review is owed (DEBT-034). Extends/qualifies ADR-0002.
- **Context owner:** the recordings/library model (`recordings.ts`), the Song scheduler (`arrangement.ts`),
  and a new frontend audio path (`voiceAudio.ts`, `voiceStore.ts`).

## Context

Every "Composition" so far is a **symbolic** event stream — note on/off + preset, replayed into the Rust synth
(ADR-0002). The whole Song scheduler (`flattenArrangement`, ADR-0007) is built on that: a clip flattens to
note events. The user now wants to **record their voice** (microphone) and apply **distortion + funny effects**,
and the voice takes must appear in the Song workspace as clips alongside keyboard compositions.

A voice take is **real audio** (mic PCM), not notes. It cannot flatten to a symbolic stream. So this introduces
the app's **first audio asset** — a genuine departure from ADR-0002's "recordings are symbolic, not audio".

## Decision

**Recordings become a tagged union of two kinds, sharing ONE library and one persistence path** so voice takes
appear in Song for free:

- `Recording.kind?: "keyboard" | "voice"` — `undefined` ⇒ `"keyboard"` (back-compat with every saved take).
- A **keyboard** take keeps `events: RecEvent[]` (the symbolic stream), as today.
- A **voice** take has `events: []` and an `audio: { blobKey, mimeType, effect }` reference. The raw audio Blob
  lives in **IndexedDB** (`voiceStore.ts`), keyed by `blobKey`; localStorage keeps only the small metadata
  (localStorage is ~5 MB-capped and already holds the symbolic library).

**Capture + effects are entirely frontend, via the Web Audio API — no Rust DSP, the synth engine is untouched:**

- **Capture:** `getUserMedia({audio})` → `MediaRecorder` → Blob → IndexedDB. (Fallback if `MediaRecorder` is
  unusable in WKWebView: an `AudioWorklet` PCM tap → WAV. The downstream `AudioBuffer` is identical either way,
  so the effect/playback code is capture-method-independent.)
- **Effects (non-destructive):** the take stores a dry Blob + an `effect` descriptor; the effect chain is built
  from Web Audio nodes at **playback** time, so effects are swappable and re-previewable for free. Mapping:
  Distortion = `WaveShaperNode`; Chipmunk/Monster = `playbackRate`; Robot = ring-mod (osc × gain);
  Echo = `DelayNode` + feedback; Telephone = band-pass `BiquadFilterNode`; Reverb = `ConvolverNode` (generated
  impulse).
- **Playback path:** `voiceAudio.ts` decodes the Blob to an `AudioBuffer` (cached) and plays it through the
  effect chain, returning a stop handle. Used by the Voice-section preview **and** (ADR-0009 follow-up) the
  arrangement Player, which gains a parallel "start/stop audio buffers at clip times" pass beside the existing
  symbolic `emit`. `flattenArrangement` stays purely symbolic and **skips voice clips**.

**Placement:** a dedicated **Voice section** — a third top-bar mode `[ Play | Voice | Song ]` — because mic +
waveform + an effects picker is a different modality from the keyboard and needs room. Takes still land in the
shared library, so the Song shelf shows them with no extra wiring.

## Consequences

- **(+) Voice takes are first-class clips** — they appear in Song and (follow-up) play in arrangements.
- **(+) Zero Rust/RT-audio risk** — capture, effects, and audio playback are all Web Audio; the cpal synth
  engine, the 16-voice gate, and `assert_no_alloc` are untouched.
- **(+) Non-destructive effects** — change the funny effect any time; the dry take is preserved.
- **(−) Two clip kinds** — `flattenArrangement`, the shelf, and the libraries must branch on `kind`. Kept small:
  the Play Library shows keyboard takes, the Voice section shows voice takes, the Song shelf shows both.
- **(−) playbackRate effects (chipmunk/monster) change duration** — a voice clip's played length ≠ its recorded
  length under those effects; the arrangement-playback follow-up must account for that in clip width/scheduling.
- **(−) New permission + storage surfaces** — macOS mic entitlement (`NSMicrophoneUsageDescription`) and
  IndexedDB. The mic permission in the Tauri WKWebView is the feasibility gate (proven by the first in-app run).

## Alternatives considered

- **Rust `cpal` input stream** for capture (and Rust DSP for effects): far more invasive (second audio stream,
  device handling, RT-safe DSP, IPC of audio frames) for no user-visible benefit over Web Audio. Rejected as the
  primary path; kept as the fallback only if WKWebView mic capture proves unworkable.
- **Bake effects into the stored audio** (destructive, via `OfflineAudioContext`): simpler arrangement playback
  (one buffer), but loses re-editing and bloats storage with one blob per effect tweak. Rejected — non-destructive
  is cheap with Web Audio.
- **Reuse `events` for audio** (e.g. a single "audio" event): muddies the symbolic contract ADR-0002/0007 rely
  on. Rejected in favour of an explicit `kind` + `audio` field.
- **Put voice in the Play section**: less UI but crowds the keyboard view and leaves the effects picker homeless.
  Rejected in favour of a dedicated Voice section (the library is still shared, which is what Song needs).
