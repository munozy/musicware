# ADR-0003 — Master output: user volume + post-render hard-limiter (supersedes the fixed 1/VOICE_COUNT attenuation in practice)

> Owner: Architecture (`moonozy-architect`). Format: Michael Nygard. **ADRs are immutable** — never rewrite an
> accepted ADR; supersede it with a new one and set this one's Status to "Superseded by ADR-000M".

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Architecture + developer (munozy)

## Context

The STORY-K3 polyphony engine (ADR-0001, PRD-002) scales the summed voices inside `render_block` by a **fixed
`MASTER_GAIN = 1/VOICE_COUNT` (= 1/16)**. That constant is a *headroom proof*: each voice contributes at most
`AMPLITUDE` (0.8) and `env ∈ [0,1]` and every waveform is bounded to `[-1,1]`, so the summed-then-scaled mix
stays within `[-AMPLITUDE, AMPLITUDE]` for **any** number of voices and **any** phases — the render can never
clip, *by construction*, with no zipper/pumping as voices enter and leave.

The cost of that safety: a **single note peaks at only `AMPLITUDE/VOICE_COUNT ≈ 0.05` (≈ −26 dBFS)** — far too
quiet, because the fixed 1/16 budgets headroom for 16 simultaneous full-scale voices that almost never occur in
real play. There was also **no user volume control at all**. We need the instrument to be **audibly loud by
default** and **user-adjustable**, without giving up the guarantee that the engine can never emit an
out-of-range sample to the DAC.

## Decision

We will add a **user master volume** and a **post-render hard-limiter** as a dedicated output stage, applied
**after** `render_block`:

- **Volume model.** Master volume is a single **`level ∈ [0, 1]`**, default **`DEFAULT_VOLUME = 0.6`**, stored
  as `f32` bits in an `AtomicU32` and **read once per audio block** (so it never zips mid-block). The UI sets it
  via the **`set_volume` Tauri command** → `AudioEngine::set_volume`, which **clamps to `[0,1]` and coerces NaN
  to 0** so any UI value is safe.
- **Gain mapping.** The rendered mix is scaled by **`level × VOLUME_GAIN_MAX`**, where
  **`VOLUME_GAIN_MAX = VOICE_COUNT / AMPLITUDE`**. Because `render_block` already attenuated a single full voice
  to `AMPLITUDE × MASTER_GAIN`, this brings it back to full scale, so **`level == 1.0` reads as "single-note
  full scale"** and the knob reads as single-note peak amplitude.
- **Limiter.** `apply_master_volume()` scales then **hard-clamps every sample to `[-1, 1]`**. The clamp
  guarantees a valid output sample **by construction**, however hard `level` is driven or however many voices
  sound — the engine can never emit something the DAC would wrap or distort.
- **`render_block`'s internal headroom proof is preserved unchanged.** The fixed `1/VOICE_COUNT` scale stays
  inside `render_block` (no zipper as voices enter/leave); the user gain and the limiter are a **separate,
  later** stage. In *practice* the audible ceiling is now the **limiter**, not the fixed attenuation — hence
  this ADR "supersedes the fixed 1/VOICE_COUNT attenuation in practice" while leaving its code and proof intact.

## Consequences

- **Positive:**
  - A single note at the default level is **~12× louder** (≈ +21 dB) than the old fixed-1/16 path — audible and
    pleasant by default — while staying below the ceiling for typical play.
  - **User-adjustable** loudness via a clamped, NaN-safe command, persisted in the UI (`localStorage`).
  - **No out-of-range sample is possible**, for any level or any voice count — the limiter makes it a guarantee,
    not a hope.
  - **No zipper/pumping from voice count:** the per-voice scale inside `render_block` stays constant; only a
    deliberate user level change moves the gain, applied per block.
  - The volume is purely an **output/monitor** setting — orthogonal to notes, presets, and recording, so it is
    deliberately **not** captured by the recorder (see ADR-0002).
- **Negative (cost accepted):**
  - **Dense chords can reach the limiter** and hard-clip at the `[-1,1]` ceiling. The "never *reach* the
    ceiling" headroom guarantee (the fixed 1/16) is replaced *in practice* by a "never *exceed* the ceiling"
    limiter: with the default level a moderate number of in-phase voices stays clean, but a loud, dense cluster
    can clip. We accept audible limiting at the extreme as the price of a usable default loudness.
  - A **hard clamp is the crudest limiter** — it distorts (square-ish edges) rather than gracefully compressing
    when it engages.
- **Risks (with mitigation / fitness function):**
  - **Hard-clip distortion on dense chords could sound bad.** *Mitigation:* the default level (0.6) leaves the
    limiter room; a softer limiter is a clean future supersession (see alternatives). *Fitness function:* the
    Rust suite asserts `set_volume` clamps and NaN→0, that the limiter **scales then clamps**, and that
    `level == 1.0` yields full single-note scale.
  - **Confusion between the two scaling stages** (`render_block`'s 1/16 vs. the output `level × VOLUME_GAIN_MAX`).
    *Mitigation:* the two stages are documented in `audio.rs` and separated by responsibility — render proves
    boundedness, the output stage applies user gain + limiting.

## Alternatives considered

1. **Keep the fixed `1/VOICE_COUNT` (1/16) only** — the status quo, with its clean "never clips by construction"
   proof. *Rejected:* a single note at ≈ −26 dBFS is **too quiet**, and there is no user control. The proof is
   correct but budgets for a worst case (16 full-scale voices) that real play never hits, at the cost of
   everyday loudness.
2. **Normalize by the active voice count** (scale by `1/sounding_count`). *Rejected:* the gain would jump every
   time a voice enters or leaves, causing audible **pumping / zipper** noise — exactly what the constant
   `MASTER_GAIN` was chosen to avoid.
3. **A soft-knee compressor / look-ahead limiter.** The "right" pro-audio answer for graceful loudness.
   *Rejected for now:* real-time cost and meaningful DSP complexity (envelope detector, attack/release,
   look-ahead buffer) inside the `assert_no_alloc` callback, for a learning keyboard. A clean future
   supersession once limiting is actually objectionable in use.
4. **Per-voice gain only** (raise `AMPLITUDE`, drop the master scale). *Rejected:* without a summed-output
   limiter it would **clip on chords**, breaking the "never emit an out-of-range sample" guarantee that the DAC
   relies on; loudness would be unbounded in voice count.
5. **Do nothing** — ship without volume. *Rejected:* too quiet and uncontrollable; fails basic usability.

## Links
PRD: [PRD-002](../../product/prds/PRD-002-playable-keyboard-synth.md) · Issues: PR #1 (branch `feat/composition-recorder` @ f66550d) · Related/superseded ADRs: extends [ADR-0001](ADR-0001-react-tauri-rust-audio-engine.md); **supersedes the fixed `1/VOICE_COUNT` attenuation in practice** (the constant and its `render_block` proof remain in code); related to [ADR-0002](ADR-0002-composition-recording-frontend-event-stream.md) (volume excluded from capture) · Tech-spec: — · Glossary terms touched: ADDS "Master volume", "Limiter"; uses voice, polyphony, Tauri command, buffer.
