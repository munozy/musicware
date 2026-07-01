# DEBT-034 — Adversarial + Council Re-review

_Owed since 2026-06-26 (org API spend limit hit mid-review). Run 2026-07-01 against `main` (post Slice 7b + 8b)._

**Method:** 8-dimension adversarial finder pass -> dedup -> 2 diverse skeptics per non-nit finding (kept unless BOTH refute) -> Moonozy Council 5-axis re-score. 91 agents.

## Council verdict

**Overall: 67/100 - FAIL** (threshold 85)

| Axis | Score |
|---|---|
| Product & UX value (Cagan/Torres/Norman/Nielsen) | 13 |
| Domain integrity (Evans/Vernon) | 16 |
| Architectural soundness (Fowler/Nygard/Brown) | 13 |
| Code craft (Martin/Beck/Pocock) | 13 |
| AI & flow discipline (Karpathy/Cherny/DORA) | 12 |

### Blocking issues
- [high] Silent data loss: saveSongs/saveRecordings/saveArrangement/saveVideoProjects swallow QuotaExceededError with only console.error (songsStore.ts:88-95) — user believes work is saved, loses it on next launch. Must surface the failure to the user (this violates the memory invariant that the create-bricks loop is the product; losing the bricks is the worst failure).
- [high] Core feature unreachable + false ARIA for keyboard/AT users: the Ruler is role=slider with aria-valuenow but has no tabIndex/onKeyDown (Timeline.tsx:510-521), so seek and loop-region (the headline Slice 7b feature) are pointer-only and the slider role lies to screen readers. Add focusability + arrow-key handling or drop the slider ARIA.
- [high] SectionBand delete/suggest buttons render at opacity:0 with no :focus/:focus-within reveal (App.css:1601-1642) — WCAG 2.4.7; keyboard focus lands on a fully transparent control. Mirror the .timeline-clip:focus-within reveal already used for clips.
- [medium/audio] Stale-buffer race in the arrangement voice path (useArrangement.ts:291-299): the async decode is guarded only by truthiness of playerRef.current, not run identity, so a voice clip from a prior play session sounds during a new run. Add a runId/epoch token like the preview path already has (previewIntentRef).
- [medium/resource] Written-but-unwired cleanup: deleteBlob (voiceStore.ts:61) and clearVoiceBuffer (voiceAudio.ts:42) have zero call sites (grep-confirmed) — IndexedDB blobs and decoded PCM leak monotonically for the life of the install; wire them into delete/remove/import-failure paths.
- [medium/security] Overbroad standing fs scope: capabilities/default.json:11-17 grants read+write over $HOME/** while every real write goes through a native dialog path; combined with the unsafe-inline/unsafe-eval CSP (tauri.conf.json:25) any content injection becomes read/overwrite of arbitrary user files. Narrow the scope and tighten the CSP.
- [process/coverage] The entire arrangement voice-clip and Slice-7b voice loop/seek scheduling paths are untested (grep confirms no voiceAudio/loadVoiceBuffer/playVoice reference in useArrangement.test.tsx) — the exact paths carrying the confirmed bugs above have no eval. This is the DEBT-034 gap: write the failing tests before/with the fixes.

### Council narrative
This is the OWED re-review (DEBT-034) of a large batch of increments — Slices 1-9, voice, export, video, project I/O, the ADR-0008 engine change, Slices 7b/8b — that shipped without the adversarial verifiers or the Council because the API spend limit hit mid-review. The verdict must reflect the code as it stands, and honestly, it stands below the bar: 0 critical but 3 high and 16 medium confirmed findings, clustered exactly where the process broke down.\n\nThe split is stark and instructive. The symbolic core — the arrangement scheduler, the Rust RT-audio engine, ADSR/VoicePool/limiter — is genuinely excellent: 363 vitest + 53 Rust tests, strict typing, alloc-free callback, KA-1 regression suite, a non-vacuous 16-voice audio-smoke running on real CoreAudio in CI. If the increment were only that, it would clear 85. But everything BUILT AROUND the core — the async voice lifecycle, project import/export, video export, localStorage/IndexedDB persistence — shipped fast and unverified, and it shows: a stale-buffer race, two preview-strand bugs, loop-boundary voice stacking, four accumulating resource leaks with the cleanup functions written-but-unwired (deleteBlob and clearVoiceBuffer are literally dead code), silent quota-exceeded data loss, and an overbroad fs+CSP posture. None of these are theatrical; they are the natural consequence of velocity outrunning the eval loop.\n\nWhat would Andrej Karpathy think of this orchestration? He would recognise both the virtue and the failure. The virtue: no theatrical multi-agent dance, real fast CI, a headline eval that actually runs. The failure is the one he warns about most — the leash went slack. A dozen increments accumulated before human/adversarial verification caught up, and the parts with the weakest evals (the async audio path, which has ZERO tests per grep) are exactly the parts now full of bugs. Evals are everything, and the evals for the audio LIFECYCLE were never written even though the pattern to guard it (previewIntentRef) already existed one function away. His prescription: shrink the batch, and turn every one of these findings into a failing test before the fix — close the loop that this review is belatedly closing.\n\nWould Marty Cagan find this relevant? Yes — and he would not sign off. The problem is validated (OQ-3 Gate A), the recombine-loop vision is sound, and desirability is real. But Cagan de-risks across Value, Usability, Feasibility, Viability, and this increment ships the Usability risk unmitigated: six core actions (seek, loop, section edit/move, frame-select, record-toggle) are mouse-only or lie to assistive tech, and the single worst outcome — silent loss of the user's saved bricks on quota-exceeded — strikes at the heart of the product's own stated invariant that the create-bricks loop IS the product. Fall in love with the problem, then protect the user's work.\n\nThe thinker behind the lowest axis (AI & flow discipline, 12/20) is Karpathy, and his critique above is the sharpest one: this is under-verified velocity, not over-engineering. The fix is not to slow down permanently but to promote the recurring [automatable] classes into the gate so the loop stops re-judging by hand. Recommendation: FAIL against the 85 threshold. Fix the three highs plus the stale-buffer race and the leaks, write the missing voice-path tests, then re-score — the core quality means the ceiling is high once the surrounding I/O is hardened."

## Confirmed findings (40)

| # | Sev | Dimension | Finding | Location |
|---|---|---|---|---|
| 1 | high | data-integrity | localStorage quota / write failures are swallowed with only console.error — user believes work is saved | `src/songsStore.ts:88-95` |
| 2 | high | ux-a11y | Ruler declares role="slider" but is not focusable or keyboard-operable — seek & loop are pointer-only | `src/Timeline.tsx:510-521 (Ruler return), 483-506 (handlePointerDown)` |
| 3 | high | ux-a11y | SectionBand delete/suggest buttons are invisible to keyboard focus (opacity:0 with no :focus-within reveal) | `src/App.css:1629-1642 (.section-suggest), 1601-1620 (.section-del), reveal rules 1618 & 1640` |
| 4 | medium | audio-scheduler | Arrangement voice decode has no run-generation guard — a stale buffer from a prior run attaches to a newer play | `src/useArrangement.ts:291-299` |
| 5 | medium | audio-scheduler | Preview double-click during decode orphans an unstoppable voice handle (same-take toggle-off misses) | `src/useArrangement.ts:360-388` |
| 6 | medium | audio-scheduler | Voice clips are not force-truncated at the loop-region boundary (bleed past the cycle) | `src/useArrangement.ts:305-313` |
| 7 | medium | tauri-security | Dev-permissive CSP (unsafe-inline + unsafe-eval, no script-src) makes any XSS near-RCE in an fs-capable WKWebView | `src-tauri/tauri.conf.json:25` |
| 8 | medium | tauri-security | fs allow-list grants standing read+write to all of $HOME/$DOWNLOAD/$DESKTOP/$DOCUMENT but the app only ever writes user-picked dialog paths | `src-tauri/capabilities/default.json:11-17` |
| 9 | medium | data-integrity | deleteBlob is never called — unbounded IndexedDB leak on delete / import / partial-import failure | `src/voiceStore.ts:61-70` |
| 10 | medium | web-audio-export | Video-export MediaStreamTracks (canvas capture + audio dest) are never stopped — leak per export | `src/videoExport.ts:91-146` |
| 11 | medium | web-audio-export | Decoded voice-buffer cache grows unbounded; clearVoiceBuffer is dead code | `src/voiceAudio.ts:27-44` |
| 12 | medium | web-audio-export | OfflineAudioContext length is unclamped — long song can blow up memory | `src/exportSong.ts:47-60` |
| 13 | medium | react-lifecycle | useVoiceRecorder.preview has no async intent-guard — overlapping previews strand voice audio | `src/useVoiceRecorder.ts:131-152` |
| 14 | medium | ux-a11y | Section move/resize is pointer-only — no keyboard path to reposition or resize a section | `src/SectionBand.tsx:42-58 (beginDrag), 66-72 (section-block onPointerDown), 127 (.section-resize span)` |
| 15 | medium | ux-a11y | Video filmstrip frame-select is a mouse-only <li> (no role/tabIndex/keyboard) | `src/VideoView.tsx:320-324` |
| 16 | medium | ux-a11y | Voice Record toggle button lacks aria-pressed / role=switch — recording state is not exposed as state | `src/VoiceView.tsx:42-49` |
| 17 | medium | new-slices-7b-8b | Marquee suppressClearRef stays true forever if the drag releases outside .timeline-tracks, swallowing the next click | `src/Timeline.tsx:598, 627-632` |
| 18 | medium | new-slices-7b-8b | Voice audio is not force-closed at a loop-region boundary — a voice clip extending past the region end stacks across cycles | `src/useArrangement.ts:302-320` |
| 19 | medium | new-slices-7b-8b | Voice clip loop/seek scheduling uses recorded durationMs, ignoring playbackRate effects (chipmunk/monster) that change played length | `src/useArrangement.ts:303-317` |
| 20 | low | audio-scheduler | The entire arrangement voice-clip playback path is untested | `src/useArrangement.test.tsx:1-45` |
| 21 | low | rt-audio-engine | Unbounded per-sample phase-wrap loop for out-of-range note numbers (RT callback) | `src-tauri/src/audio.rs:880-885, 296-299, 857-860` |
| 22 | low | rt-audio-engine | Exported audio is ~2.5 dB louder than live monitoring (offline/live gain divergence) | `src-tauri/src/audio.rs:917, 980, 1240-1241` |
| 23 | low | tauri-security | render_song allocates an unbounded buffer from caller-supplied total_ms — memory-exhaustion DoS | `src-tauri/src/lib.rs:72-74` |
| 24 | low | tauri-security | Image import derives MIME type from the file extension of a user-picked path with a silent image/png fallback | `src/useVideo.ts:102-104` |
| 25 | low | data-integrity | parseProjectBundle validates only the top-level shape; malformed tracks/recordings reach remapProject and throw a raw TypeError | `src/songProject.ts:84-102, 136-144` |
| 26 | low | data-integrity | A recording with a non-array `events` (or a clip referencing an unknown recordingId) is silently accepted and persisted | `src/songProject.ts:119-142` |
| 27 | low | data-integrity | Voice take exported with a missing blob re-imports pointing at a stale, non-existent blobKey (silent audio loss) | `src/songProject.ts:66-72, 122-129` |
| 28 | low | data-integrity | Cross-store commits are non-atomic: import can persist blobs/recordings without the song (or vice-versa) | `src/SongView.tsx:272-274` |
| 29 | low | data-integrity | openDB caches a rejected promise and getBlob has no onabort handler (possible permanent failure / hang) | `src/voiceStore.ts:18-31, 50-59` |
| 30 | low | web-audio-export | Song and Video exports are guarded only by component-local flags, so a synth export and a video export can run concurrently | `src/SongView.tsx:211-221` |
| 31 | low | react-lifecycle | useVideo object-URL effect revokes and recreates ALL image URLs whenever the image set changes | `src/useVideo.ts:66-85` |
| 32 | low | react-lifecycle | VideoView async handlers setState after the component may have unmounted | `src/VideoView.tsx:55-167` |
| 33 | low | ux-a11y | Master volume slider announces raw 0–1 value, not the visible percentage | `src/VolumeControl.tsx:56-65, 75` |
| 34 | low | ux-a11y | Marquee box-select has no keyboard equivalent | `src/Timeline.tsx:571-604 (handleMarqueeDown)` |
| 35 | low | ux-a11y | ClipShelf keyboard placement (keys 1/2/3) can only reach the first three tracks | `src/ClipShelf.tsx:37-45` |
| 36 | low | ux-a11y | Destructive confirm/delete actions drop focus to <body> after the element unmounts | `src/TrackHeader.tsx:131-143 (Yes/No), 146-154 (delete → confirm)` |
| 37 | low | new-slices-7b-8b | Window pointer listeners (marquee, ruler seek/loop, clip trim) leak on unmount mid-drag | `src/Timeline.tsx:162-163, 504-505, 602-603` |
| 38 | low | new-slices-7b-8b | The voice-clip loop/seek scheduling path in play() is untested | `src/useArrangement.ts:291-320` |
| 39 | low | new-slices-7b-8b | A tiny loop region can schedule up to 2000 × loopCount × (voice clips in region) setTimeout timers | `src/useArrangement.ts:278, 303-312` |
| 40 | nit | data-integrity | newId() truncates its random suffix to 6 base-36 chars; remap's 'collision-free' claim is probabilistic, not guaranteed | `src/recordings.ts:79-81` |

### Detail

#### 1. [high] localStorage quota / write failures are swallowed with only console.error — user believes work is saved
- **Where:** `src/songsStore.ts:88-95` (data-integrity, 2/2 skeptics upheld)
- **What:** saveSongs, saveRecordings, saveArrangement, and saveVideoProjects all wrap setItem in try/catch that only console.errors. When the library grows past the ~5MB localStorage quota (large keyboard takes with dense event arrays, or many songs), setItem throws QuotaExceededError, the whole persist is dropped, and the app continues showing the in-memory state as if saved. On next launch the last (and potentially many prior) edits are gone with no prior warning. Same pattern in all four stores.
- **Evidence:** export function saveSongs(songs, activeId) {
  try { localStorage.setItem(SONGS_KEY, JSON.stringify(songs)); localStorage.setItem(ACTIVE_KEY, activeId); }
  catch (e) { console.error("failed to persist songs", e); }   // silent to the user
}
- **Fix:** Surface persist failures to the UI (a non-blocking 'Couldn't save — storage full' banner) and/or move large payloads (keyboard event streams) off localStorage into IndexedDB like voice/image blobs already are.

#### 2. [high] Ruler declares role="slider" but is not focusable or keyboard-operable — seek & loop are pointer-only
- **Where:** `src/Timeline.tsx:510-521 (Ruler return), 483-506 (handlePointerDown)` (ux-a11y, 2/2 skeptics upheld)
- **What:** The ruler is the sole control for both setting the playback start (click) and defining a loop region (drag). It is marked role="slider" with aria-valuemin/max/now, which promises an adjustable widget, but the element has no tabIndex (so it can never receive keyboard focus) and no onKeyDown handler. All logic lives in onPointerDown. A keyboard-only or switch user cannot move the play-from position or create/adjust a loop region at all, and a screen-reader user is told there is an adjustable slider that then does nothing to arrow keys. This is both a pointer-only keyboard trap-equivalent (no keyboard path to a core feature) and an incorrect-ARIA barrier.
- **Evidence:** <div ref={rulerRef} className="timeline-ruler" role="slider" aria-label="Playback ruler — click to set the start position, drag to set a loop region" aria-valuemin={0} aria-valuemax={Math.round(RULER_WIDTH_MS)} aria-valuenow={Math.round(seekMs)} title="Click to set where Play starts · drag to set a loop region" onPointerDown={handlePointerDown}>  // no tabIndex, no onKeyDown
- **Fix:** Add tabIndex={0} and an onKeyDown handler: Left/Right (and PageUp/Down) call onSeek(seekMs ± gridMs) clamped to [0, RULER_WIDTH_MS]; Home = onSeek(0). For loop-region entry, add a keyboard affordance (e.g. Shift+Left/Right to grow/shrink the region, or a small explicit control in SongTransport). Also add aria-valuetext with a human time (e.g. "1.4 seconds") since aria-valuenow is raw ms.

#### 3. [high] SectionBand delete/suggest buttons are invisible to keyboard focus (opacity:0 with no :focus-within reveal)
- **Where:** `src/App.css:1629-1642 (.section-suggest), 1601-1620 (.section-del), reveal rules 1618 & 1640` (ux-a11y, 2/2 skeptics upheld)
- **What:** The ✨ Suggest and × Remove buttons inside each section block are real focusable <button>s (SectionBand.tsx:103-126) rendered at opacity:0, revealed only by `.section-block:hover`. Unlike the clip toolbar — which correctly reveals on `.timeline-clip:focus-within` — there is no :focus / :focus-within rule for the section buttons. A keyboard user tabbing through the Structure band lands focus on a fully transparent control: they cannot see which button is focused or whether it is the rename/suggest/delete. This is a WCAG 2.4.7 (focus visible) failure and makes section delete/suggest effectively unusable without a mouse.
- **Evidence:** .section-suggest { ... opacity: 0; transition: opacity 0.1s; }
.section-block:hover .section-suggest { opacity: 1; }
/* grep for section-del:focus / section-block:focus-within returns nothing */
- **Fix:** Add `.section-block:focus-within .section-del, .section-block:focus-within .section-suggest { opacity: 1; }` (mirror the existing .timeline-clip:focus-within pattern), and give the focused button a visible outline.

#### 4. [medium] Arrangement voice decode has no run-generation guard — a stale buffer from a prior run attaches to a newer play
- **Where:** `src/useArrangement.ts:291-299` (audio-scheduler, 2/2 skeptics upheld)
- **What:** fireVoice schedules an async loadVoiceBuffer().then() whose only guard against a superseded run is the truthiness of playerRef.current — not the identity of the run that scheduled it. Sequence: play() (run A) sets playerRef.current = playerA and schedules a voice timer; the timer fires and starts an async decode; the user hits Stop (stopInternal clears timers, stops current handles, sets playerRef.current = null); the user hits Play again, so play() (run B) sets playerRef.current = playerB; NOW the in-flight decode from run A resolves. The guard `!playerRef.current` is false (playerB is set), so it runs `voiceHandlesRef.current.push(playVoice(buf, vp.effect))` — a voice clip from the PREVIOUS playback session begins sounding during run B, out of place. It is tracked in run B's handles so it is not permanently stranded (run B's stop cleans it up), but the user hears wrong audio. Contrast the PREVIEW path (line 376) which correctly uses previewIntentRef to reject a superseded async decode — the arrangement voice path has no equivalent token. Confirmed by grep: no generation/epoch/runId ref exists for the arrangement voice path.
- **Evidence:** const fireVoice = (vp, at) => {
  const timer = setTimeout(() => {
    void loadVoiceBuffer(vp.blobKey).then((buf) => {
      if (!buf || !playerRef.current) return; // stopped before the buffer decoded
      voiceHandlesRef.current.push(playVoice(buf, vp.effect));
    });
  }, at);
  voiceTimersRef.current.push(timer);
};
- **Fix:** Capture a per-run generation token at play() start (e.g. `const gen = ++playGenRef.current;`) and check it inside the decode continuation: `if (!buf || playGenRef.current !== gen) return;`. Increment playGenRef in stopInternal and at the top of play(). This mirrors previewIntentRef and closes the stop→play stale-buffer race the prompt calls out.

#### 5. [medium] Preview double-click during decode orphans an unstoppable voice handle (same-take toggle-off misses)
- **Where:** `src/useArrangement.ts:360-388` (audio-scheduler, 2/2 skeptics upheld)
- **What:** The toggle-off detection is `playingThis = previewingId === rec.id && (previewRef.current || voicePreviewRef.current)`. For a VOICE take, voicePreviewRef.current stays null until the async decode resolves and playVoice runs. So a second click on the SAME take while it is still decoding sees playingThis === false (both refs null), so instead of stopping it, it falls through: stopPreview() nulls previewIntentRef, then previewIntentRef.current = rec.id is set AGAIN, and a SECOND decode of the same take is kicked off. Both in-flight decodes now carry intent === rec.id, so BOTH pass the guard at line 376. The first resolves and sets voicePreviewRef.current = handle#1 (sounding); the second resolves and OVERWRITES voicePreviewRef.current = handle#2 (also sounding). handle#1 is now playing but unreferenced — stopPreview() can only stop handle#2, so handle#1 is a stranded voice the user cannot stop (it self-ends via onended, so not permanent). The intent-ref guard defends against a DIFFERENT take superseding but not against the same take being re-triggered mid-decode.
- **Evidence:** const playingThis = previewingId === rec.id && (previewRef.current || voicePreviewRef.current);
if (playingThis) { stopPreview(); return; }
...
void loadVoiceBuffer(blobKey).then((buf) => {
  if (previewIntentRef.current !== rec.id) return; // a newer preview superseded this
  ...
  voicePreviewRef.current = playVoice(buf, effect, () => {...});
});
- **Fix:** Track a pending-decode marker so a same-take re-click during decode is treated as playingThis (toggle off): e.g. set previewingId optimistically (already done) and gate on `previewIntentRef.current === rec.id` in the toggle check, OR carry a generation token like the arrangement path and reject stale/duplicate decodes so only the latest decode assigns voicePreviewRef.

#### 6. [medium] Voice clips are not force-truncated at the loop-region boundary (bleed past the cycle)
- **Where:** `src/useArrangement.ts:305-313` (audio-scheduler, 2/2 skeptics upheld)
- **What:** For symbolic notes, buildPlaybackStream force-closes any note still held at each loop-cycle boundary (arrangement.ts:316), preserving the no-stacking guarantee. But voice audio has no equivalent: a voice clip whose start lands inside the loop region is scheduled with playVoice(buf, effect) and plays its FULL vp.durationMs with no stop at base+loopLen. If a voice clip starts near the end of the loop window (or the loop window is shorter than the clip), the audio bleeds past the loop point and can overlap the next cycle's restart of the same clip — two copies of the same voice sounding. This is adjacent to the ADR-0009 'clips beginning mid-window are skipped' limitation but is a different case (a clip that STARTS in-window but is longer than the remaining window). It is audible layering, not a stuck note.
- **Evidence:** if (playStart >= loopRegion!.startMs && playStart < loopRegion!.endMs) {
  const rel = playStart - loopRegion!.startMs;
  for (let c = 0; c < cycles; c++) {
    const at = rel + c * loopLen;
    endMs = Math.max(endMs, at + vp.durationMs);
    fireVoice(vp, at); // no stop scheduled at at + (loopLen - rel) — plays full durationMs
  }
}
- **Fix:** When looping, schedule a stop for each voice handle at the cycle boundary (base + loopLen) so voice audio is truncated at the loop point like symbolic notes, or document this bleed as an explicit V1 limitation alongside the mid-window-skip note in ADR-0009 and the play() docstring.

#### 7. [medium] Dev-permissive CSP (unsafe-inline + unsafe-eval, no script-src) makes any XSS near-RCE in an fs-capable WKWebView
- **Where:** `src-tauri/tauri.conf.json:25` (tauri-security, 2/2 skeptics upheld)
- **What:** The production CSP allows 'unsafe-inline' and 'unsafe-eval' and declares only default-src (no dedicated script-src), so script execution falls back to that permissive default. In a WKWebView that also holds fs read/write capability and IPC commands, this means any injected markup or eval'd string runs as trusted app code and can freely call the fs plugin and render_song. It also lists ws:/wss:/http://localhost:*/https://localhost:* connect-sources that are pure Vite dev-server artifacts — the frontend makes no fetch/WebSocket/HTTP calls at runtime (grep for WebSocket/fetch/XHR in src/ returns nothing), so these are dead attack surface in the shipped app. The permissive CSP is the multiplier that upgrades a small content-injection bug into data exfiltration/overwrite of the user's files.
- **Evidence:** "csp": "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: filesystem: media: mediastream: ws: wss: http://localhost:* https://localhost:* ipc: http://ipc.localhost tauri: asset: https://asset.localhost"
- **Fix:** Split into explicit directives for the release build and keep the mic sources. Concretely: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: asset: https://asset.localhost; media-src 'self' blob: data: mediastream: media:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-ancestors 'none'". This drops 'unsafe-eval' and script-side 'unsafe-inline' (Vite emits external module scripts, so 'self' suffices in the bundled app), removes ws:/wss:/localhost, but retains media:/blob:/mediastream:/data: so getUserMedia keeps working (per the documented mic requirement). Keep the current permissive CSP only for dev via a separate config/env if Vite HMR needs unsafe-eval.

#### 8. [medium] fs allow-list grants standing read+write to all of $HOME/$DOWNLOAD/$DESKTOP/$DOCUMENT but the app only ever writes user-picked dialog paths
- **Where:** `src-tauri/capabilities/default.json:11-17` (tauri-security, 2/2 skeptics upheld)
- **What:** Every file operation in the app writes or reads a path returned by a native save()/open() dialog the user just interacted with — SongView.tsx (writeFile at 214/245, readFile at 270), VideoView.tsx (writeFile at 74/159, readFile at 99), useVideo.ts (readFile at 104). Tauri's dialog-returned paths are honored on their own; a broad pre-declared fs scope is not what makes the dialog write succeed. Granting fs:allow-write-file AND fs:allow-read-file over $HOME/** (which subsumes the other three) means that if script ever runs in the webview (see CSP finding), it can read or overwrite ANY file under the user's home — SSH keys, dotfiles, other apps' data — without a dialog. The scope is far wider than the export/import features require.
- **Evidence:** { "identifier": "fs:allow-write-file", "allow": [{ "path": "$HOME/**" }, { "path": "$DOWNLOAD/**" }, { "path": "$DESKTOP/**" }, { "path": "$DOCUMENT/**" }] }, { "identifier": "fs:allow-read-file", "allow": [{ "path": "$HOME/**" }, ...] }
- **Fix:** Prefer relying on the dialog plugin's per-call path grant and drop the standing fs scope entirely if testing confirms writes still work. If a scope must remain, narrow it to the export/import targets only: write-file limited to $DOWNLOAD/** and $DOCUMENT/** (drop $HOME/** and $DESKTOP/**), and read-file to the same. Remove $HOME/** in all cases since it dominates the intended dirs. Ideally split into a separate capability so read and write scopes are minimal and independently auditable.

#### 9. [medium] deleteBlob is never called — unbounded IndexedDB leak on delete / import / partial-import failure
- **Where:** `src/voiceStore.ts:61-70` (data-integrity, 2/2 skeptics upheld)
- **What:** deleteBlob() (and clearVoiceBuffer) are exported but have ZERO call sites anywhere in the app (grep confirms only the definition and the videoStore/voiceAudio equivalents). Deleting a voice recording (useRecorder.remove) only filters the metadata list and never frees the audio blob; removing a video image, deleting a song, and importProjectBundle's partial-failure path (blobs written in the loop before a later atob throw) all leave their bytes in IndexedDB forever. The blob KV therefore grows monotonically for the life of the install and can eventually hit the origin storage quota, at which point putBlob's transaction errors are swallowed (only rejects a promise the caller awaits) and new voice audio silently fails to persist.
- **Evidence:** // voiceStore.ts — defined but never invoked
export async function deleteBlob(key: string): Promise<void> { ... }
// useRecorder.ts remove(): metadata dropped, blob never freed
setRecordings((list) => list.filter((r) => r.id !== id));
// grep -rn 'deleteBlob' src (excluding tests) => only the definition line
- **Fix:** Call deleteBlob(rec.audio.blobKey) when a voice recording is permanently removed (after the undo window elapses, not on the optimistic filter), and delete image blobs in videoStore image-removal / project delete. Consider a periodic reconcile that deletes IndexedDB keys not referenced by any recording/image.

#### 10. [medium] Video-export MediaStreamTracks (canvas capture + audio dest) are never stopped — leak per export
- **Where:** `src/videoExport.ts:91-146` (web-audio-export, 2/2 skeptics upheld)
- **What:** recordVideo builds the recording stream from canvas.captureStream(fps) video tracks and a MediaStreamAudioDestinationNode's audio tracks, but at the end it only calls source.stop(), recorder.stop() and audioCtx.close(). The MediaStreamTracks themselves are never .stop()'d. captureStream keeps a live capture bound to the (soon-detached) canvas, and closing the AudioContext does not stop the tracks pulled from its MediaStreamDestination. Because a fresh canvas + stream is created on every export and nothing releases these tracks, each video export orphans live tracks; repeated exports accumulate them (medium/high per the task's 'accumulate across repeated use' rule). This is the same reason audioCtx.close() alone is insufficient.
- **Evidence:** const videoStream = canvas.captureStream(fps);
const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
...
tracks.push(...dest.stream.getAudioTracks());
...
recorder.stop();
const blob = await finished;
try {
  await audioCtx?.close();
} catch { /* ignore */ }
return { blob, ext: picked.ext };
- **Fix:** After the recorder has stopped (ideally in a finally so it also runs on the error paths), stop every track: `for (const t of tracks) { try { t.stop(); } catch {} }` — and detach the source node. Also move audioCtx?.close() and track-stopping into a finally block so an exception during the render loop or a MediaRecorder construction failure still releases them.

#### 11. [medium] Decoded voice-buffer cache grows unbounded; clearVoiceBuffer is dead code
- **Where:** `src/voiceAudio.ts:27-44` (web-audio-export, 2/2 skeptics upheld)
- **What:** loadVoiceBuffer caches every decoded AudioBuffer in a module-level Map keyed by blobKey and never evicts. clearVoiceBuffer exists to prune it after a take is deleted, but a repo-wide grep shows it is never called anywhere. So decoded PCM (potentially many seconds of 44.1/48k float audio per take) is retained for the lifetime of the app even after the take is deleted, and re-import of a project with fresh blobKeys just adds more entries. This is a slow but genuine accumulating memory leak across a long editing/export session, and the cleanup hook that was written to prevent it is unwired.
- **Evidence:** const bufferCache = new Map<string, AudioBuffer>();
...
export function clearVoiceBuffer(blobKey: string): void {
  bufferCache.delete(blobKey);
}
// grep clearVoiceBuffer over src/ → only the definition; no caller.
- **Fix:** Call clearVoiceBuffer(blobKey) from the take-deletion path (wherever a voice recording's blob is removed from voiceStore), and consider a bounded LRU or clearing the cache when the project changes. At minimum wire the existing API so the leak is capped.

#### 12. [medium] OfflineAudioContext length is unclamped — long song can blow up memory
- **Where:** `src/exportSong.ts:47-60` (web-audio-export, 2/2 skeptics upheld)
- **What:** totalSamples is derived directly from songDurationMs (last event / last voice-clip end) with no upper bound, then passed to new OfflineAudioContext(2, totalSamples, sampleRate), which eagerly allocates the full stereo render buffer (2 * totalSamples * 4 bytes) up front, on top of the Rust synth PCM Float32Array already in memory. A song with a clip placed far out on the timeline (e.g. loopCount * durationMs into the tens of minutes) allocates hundreds of MB before rendering, with no guard or user-facing limit. Some browsers/webviews also reject or throw for excessively large OfflineAudioContext lengths, and that would surface only as a generic 'Export failed.'
- **Evidence:** const totalMs = songDurationMs(arr, recordings) + TAIL_MS;
const totalSamples = Math.max(1, Math.ceil((totalMs / 1000) * sampleRate));
...
const ctx = new OfflineAudioContext(2, totalSamples, sampleRate);
- **Fix:** Clamp totalSamples to a sane maximum (e.g. cap totalMs at some minutes) and surface a clear message when a song exceeds it, rather than letting the allocation fail opaquely. Alternatively validate songDurationMs against a MAX_EXPORT_MS constant before rendering.

#### 13. [medium] useVoiceRecorder.preview has no async intent-guard — overlapping previews strand voice audio
- **Where:** `src/useVoiceRecorder.ts:131-152` (react-lifecycle, 2/2 skeptics upheld)
- **What:** preview() calls stopPreview(), then awaits loadVoiceBuffer(), then playVoice() and stores the handle in previewRef. If the user starts a preview of take A (uncached blob → real await) and, during the decode, starts a preview of take B, both async continuations run. stopPreview() at the top of B's call finds previewRef.current still null (A hasn't started yet), so it stops nothing. Then A's buffer resolves and playVoice(A) runs, setting previewRef.current = handleA. Then B's buffer resolves and playVoice(B) runs, OVERWRITING previewRef.current = handleB. handleA is now playing but unreferenced — stopPreview() can no longer stop it, so take A's audio plays to its natural end on top of B. The sibling hook useArrangement.previewRecording guards exactly this case with previewIntentRef (src/useArrangement.ts:99-101, set at :369, checked at :376) — useVoiceRecorder is missing the equivalent guard. There is no useVoiceRecorder.test.ts and VoiceView.test.tsx only exercises the presentational component, so this is untested.
- **Evidence:** const buf = await loadVoiceBuffer(rec.audio.blobKey);
      if (!buf) { ... }
      const handle = playVoice(buf, effect ?? rec.audio.effect, () => {
        previewRef.current = null;
        setPreviewingId(null);
      });
      previewRef.current = handle;   // <-- clobbers a handle from an earlier, still-decoding preview; the earlier one is now unstoppable
      setPreviewingId(rec.id);
- **Fix:** Mirror useArrangement: add a previewIntentRef = useRef<string|null>(null). Set previewIntentRef.current = rec.id before the await, and after the await bail out if previewIntentRef.current !== rec.id (stop the freshly-created handle or simply don't assign it). Clear it in stopPreview().

#### 14. [medium] Section move/resize is pointer-only — no keyboard path to reposition or resize a section
- **Where:** `src/SectionBand.tsx:42-58 (beginDrag), 66-72 (section-block onPointerDown), 127 (.section-resize span)` (ux-a11y, 2/2 skeptics upheld)
- **What:** A section can only be moved (drag body) or resized (drag the right handle) via pointer events wired to window pointermove/pointerup. The section-block itself has no role/tabIndex and the resize handle is a bare <span aria-hidden="true">. There is no keyboard equivalent (unlike clips, which nudge with arrows). A keyboard user can rename, suggest, and delete a section but cannot change its start or length at all. Contrast with ClipBlock which is a focusable role="button" with arrow-key move.
- **Evidence:** const beginDrag = (mode) => (e: React.PointerEvent) => { ... ops.onMoveSection/onResizeSection ... };
<div className="section-block" onPointerDown={beginDrag("move")} title=...>  // no tabIndex/role/onKeyDown
<span className="section-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
- **Fix:** Make the section-block focusable (tabIndex, role="group" or a dedicated move handle button) with arrow keys nudging startMs and Shift+arrows adjusting endMs, snapped to the grid — reuse the ClipBlock nudge pattern.

#### 15. [medium] Video filmstrip frame-select is a mouse-only <li> (no role/tabIndex/keyboard)
- **Where:** `src/VideoView.tsx:320-324` (ux-a11y, 2/2 skeptics upheld)
- **What:** Each image thumbnail is an <li onClick={() => setSelectedImageId(img.id)}> with no role, no tabIndex, and no key handler. Selecting which frame is shown in the large preview is therefore mouse-only. The reorder (‹ ›) and delete (×) buttons inside are proper buttons and reachable, but a keyboard user cannot change the previewed/selected frame, so the preview pane is effectively mouse-gated.
- **Evidence:** <li key={img.id} className={`video-thumb${selected?.id === img.id ? " selected" : ""}`} onClick={() => setSelectedImageId(img.id)}>
- **Fix:** Make the thumbnail a <button> (or add role="button" tabIndex={0} + onKeyDown for Enter/Space) with aria-pressed={selected?.id === img.id}, so the selected frame is both keyboard-selectable and announced.

#### 16. [medium] Voice Record toggle button lacks aria-pressed / role=switch — recording state is not exposed as state
- **Where:** `src/VoiceView.tsx:42-49` (ux-a11y, 2/2 skeptics upheld)
- **What:** The record button flips its aria-label between "Record voice" and "Stop recording" and swaps a color-only .recording class + a blinking dot, but carries no aria-pressed or role="switch". The only programmatic signal that recording is live is the elapsed <span role="timer">, which many screen readers do not announce as a state change. A blind user pressing the button hears the label change only on next focus, not that a toggle turned on. (Contrast: SongTransport's loop-toggle and TrackHeader's mute/solo correctly use aria-pressed.)
- **Evidence:** <button className={`voice-record-btn${isRecording ? " recording" : ""}`} onClick={isRecording ? onStop : onStart} aria-label={isRecording ? "Stop recording" : "Record voice"}>  // no aria-pressed
- **Fix:** Add aria-pressed={isRecording} (or wrap the state in an aria-live="polite" status like "Recording…"), matching the aria-pressed pattern already used on the loop and mute/solo toggles.

#### 17. [medium] Marquee suppressClearRef stays true forever if the drag releases outside .timeline-tracks, swallowing the next click
- **Where:** `src/Timeline.tsx:598, 627-632` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** handleMarqueeDown sets suppressClearRef.current = true on pointer-up of any real drag (moved), intending the trailing click to be eaten by the onClickCapture handler on .timeline-tracks, which is the ONLY place the ref is reset back to false. But a marquee that starts on empty lane space can be released with the pointer over a sibling that is NOT inside .timeline-tracks — the ruler and section band above it, the '+ Add track' button below it (both direct children of .timeline), or off the timeline / window entirely. In those cases no click event reaches .timeline-tracks, so the capture handler never fires and the ref is never cleared. The very next click that DOES reach .timeline-tracks (the user clicking a clip to select it, or empty lane to clear) is then consumed: onClickCapture runs in the capture phase and calls e.stopPropagation(), so the click never reaches the clip/lane beneath — a dead click. The user must click twice. There is no timeout, blur, or pointerdown reset to recover.
- **Evidence:** onUp: `if (moved) { ...; suppressClearRef.current = true; }` (line 598). Reset only here: `onClickCapture={(e) => { if (suppressClearRef.current) { suppressClearRef.current = false; e.stopPropagation(); } }}` on the .timeline-tracks div (lines 627-632). No other assignment of suppressClearRef exists (grep shows only 569/598/629).
- **Fix:** Don't rely on a follow-up click to clear the flag. Reset suppressClearRef.current = false at the top of handleMarqueeDown (every new gesture starts clean), and/or clear it on a microtask/rAF after onUp (e.g. queueMicrotask(() => { suppressClearRef.current = false; })) so it only ever suppresses the immediately-following click. Also reset it in the tracksRef pointerdown path so a normal click after an off-container release isn't eaten.

#### 18. [medium] Voice audio is not force-closed at a loop-region boundary — a voice clip extending past the region end stacks across cycles
- **Where:** `src/useArrangement.ts:302-320` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** For symbolic notes, buildPlaybackStream force-closes anything still held at each cycle boundary (arrangement.ts:316) so loops never stack. The parallel voice pass has no such boundary close. In the loop branch, each voice clip whose start lands inside [loopRegion.start, loopRegion.end) is (re)started at rel + c*loopLen for every cycle c, but the previously-started buffer keeps playing for its full durationMs via Web Audio — it is never stopped at the region boundary. If durationMs > (loopRegion.end - playStart) (i.e. the clip's audio is longer than the tail of the region it sits in), cycle c's buffer is still sounding when cycle c+1 restarts it, so the voice audio doubles/stacks on every loop. Only Stop / the end timer ever stops these handles.
- **Evidence:** Loop branch schedules `for (let c = 0; c < cycles; c++) { const at = rel + c * loopLen; ... fireVoice(vp, at); }` (lines 308-312) with no per-cycle stop; fireVoice just pushes a new playVoice handle each time (lines 291-299). Compare the symbolic guarantee at arrangement.ts:316 `for (const note of active) out.push({ t: base + len, kind: 'off', note });`.
- **Fix:** Schedule a stop for each voice handle at the cycle boundary (min(playStart+durationMs, loopRegion.end) relative time), mirroring the symbolic force-close, so a looped voice clip is cut at the region end before the next cycle restarts it. At minimum, skip re-triggering a clip on cycle c+1 while its cycle-c buffer would still be playing.

#### 19. [medium] Voice clip loop/seek scheduling uses recorded durationMs, ignoring playbackRate effects (chipmunk/monster) that change played length
- **Where:** `src/useArrangement.ts:303-317` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** The per-clip loop offset (playStart = vp.startMs + k * vp.durationMs) and the endMs accumulation both use vp.durationMs, which voiceClipPlays fills from rec.durationMs — the RECORDED length, effect-agnostic (arrangement.ts:280). ADR-0009 explicitly lists as a known consequence that playbackRate effects (chipmunk = faster/shorter, monster = slower/longer) make a voice clip's played length differ from its recorded length. Under monster, each looped copy of a voice clip actually plays LONGER than durationMs, so copy k+1 is scheduled before copy k's audio finishes → overlap; under chipmunk each copy finishes early → an audible gap before the next copy. The same durationMs is used to compute endMs, so the run's end timer can fire while a monster-slowed buffer is still playing (stopVoiceClips then cuts it) or long after a chipmunk buffer ended.
- **Evidence:** `for (let k = 0; k < vp.loopCount; k++) { const playStart = vp.startMs + k * vp.durationMs; ... }` (lines 303-304) and `endMs = Math.max(endMs, at + vp.durationMs)` (lines 310, 316). voiceClipPlays sets `durationMs: Math.max(0, rec.durationMs)` (arrangement.ts:280) — the dry recorded length, not the effect-adjusted one. ADR-0009 consequence: 'playbackRate effects (chipmunk/monster) change duration — a voice clip's played length ≠ its recorded length ... the arrangement-playback follow-up must account for that in clip width/scheduling.'
- **Fix:** Derive an effective playback duration from the effect (durationMs / playbackRate for chipmunk/monster; unchanged otherwise) and use it for the loop offset (k * effectiveDur) and endMs. Centralise the rate→duration mapping alongside voiceAudio's effect chain so clip width (Timeline) and scheduling agree.

#### 20. [low] The entire arrangement voice-clip playback path is untested
- **Where:** `src/useArrangement.test.tsx:1-45` (audio-scheduler, 2/2 skeptics upheld)
- **What:** useArrangement.test.tsx mocks only @tauri-apps/api/core and exercises purely the symbolic path (note_on/note_off invokes). voiceAudio.ts (loadVoiceBuffer / playVoice / VoiceHandle) is never mocked or exercised, so none of the voice lifecycle is covered: the stop→play stale-buffer race (finding #1), voice teardown on stop/unmount (stopVoiceClips), the fireVoice scheduling math, or the loop-boundary voice behaviour (finding #3). The symbolic scheduler is very well covered (363 vitest incl. KA-1 regressions); the async audio path — where the actual bugs live — has zero coverage. grep confirms no voiceAudio/loadVoiceBuffer/playVoice reference anywhere in the test file.
- **Evidence:** vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
// no vi.mock("./voiceAudio", ...) anywhere; grep for loadVoiceBuffer/playVoice/voiceHandles in the test file returns nothing.
- **Fix:** Add a vi.mock("./voiceAudio") with a fake loadVoiceBuffer that resolves on a controllable promise and a playVoice that returns a spy handle, then add tests for: (a) stop→play across an in-flight decode does not attach the old buffer to the new run; (b) stop/unmount stops all voice handles and clears voiceTimersRef/voiceHandlesRef; (c) looped voice scheduling counts.

#### 21. [low] Unbounded per-sample phase-wrap loop for out-of-range note numbers (RT callback)
- **Where:** `src-tauri/src/audio.rs:880-885, 296-299, 857-860` (rt-audio-engine, 2/2 skeptics upheld)
- **What:** In render_block the phase wrap is `while v.phase >= TWO_PI { v.phase -= TWO_PI; }` (and identically in drum_tone and the bell partial loop). The number of subtraction iterations per sample equals phase_delta/2π. `note` is a u8 (0..255) and note_to_freq(note) grows exponentially, so phase_delta is unbounded. At note 255 / sr 8000 (the render_song floor), phase_delta ≈ 16014 rad/sample → ~2548 loop iterations per sample per voice, i.e. a real CPU spike inside the RT callback rather than an O(1) wrap. It is NOT reachable through the normal UI (arrangement.ts clampNote pins notes to 0..127, where phase_delta ≤ ~1.8 rad/sample and the loop runs once), but the raw `note_on`/`note_off` Tauri commands accept any u8 with no clamp, so a direct/scripted invoke can drive it. A modulo or a debug_assert on the note range would make it O(1) and defensive.
- **Evidence:** v.phase += v.phase_delta;
// `while` (not `if`) so the wrap holds even if phase_delta ever
// exceeds 2π (absurdly high note numbers); normal notes loop once.
while v.phase >= TWO_PI {
    v.phase -= TWO_PI;
}   // note255/sr8000 → ~2548 iterations/sample/voice; note is an unclamped u8 from note_on()
- **Fix:** Either clamp the note number to 0..=127 in `note_on`/`note_off` (lib.rs) before it reaches the engine (mirroring the frontend clampNote), or replace the `while` subtraction with a single `v.phase = v.phase.rem_euclid(TWO_PI)` so the wrap is O(1) regardless of phase_delta. The rem_euclid form also removes the identical concern in drum_tone (line 296) and the bell partial loop (line 858).

#### 22. [low] Exported audio is ~2.5 dB louder than live monitoring (offline/live gain divergence)
- **Where:** `src-tauri/src/audio.rs:917, 980, 1240-1241` (rt-audio-engine, 2/2 skeptics upheld)
- **What:** render_offline bakes a fixed EXPORT_LEVEL=0.8 → apply_master_volume gain = 0.8 × VOLUME_GAIN_MAX = 16, whereas the live callback applies the user's `volume` atomic (default DEFAULT_VOLUME=0.6 → gain 12). So the exported WAV/MP3 is rendered ~2.5 dB hotter than what the user hears live at the default volume, and it ignores the live volume slider entirely. This is intentional (a named constant, and volume is deliberately not recorded per ADR-0002/0003), and both paths share the same hard limiter so nothing clips — but the divergence is undocumented at the constant and can surprise a user comparing export to playback. The DSP itself is otherwise identical between paths (same render_block/apply_event/ADSR table), which is the important invariant and it holds.
- **Evidence:** const EXPORT_LEVEL: f32 = 0.8;               // offline: gain = 0.8 * (16/0.8) = 16
...
apply_master_volume(&mut out, EXPORT_LEVEL * VOLUME_GAIN_MAX);   // render_offline
...
let level = f32::from_bits(volume.load(Ordering::Relaxed));       // live default 0.6 → gain 12
apply_master_volume(data, level * VOLUME_GAIN_MAX);
- **Fix:** No code change strictly required (accepted design). Add a one-line comment at EXPORT_LEVEL noting it deliberately diverges from the live default and is independent of the volume slider (per ADR-0003), so a future reader doesn't 'fix' it into using the live level. Optionally align EXPORT_LEVEL with DEFAULT_VOLUME if export-matches-monitor is desired.

#### 23. [low] render_song allocates an unbounded buffer from caller-supplied total_ms — memory-exhaustion DoS
- **Where:** `src-tauri/src/lib.rs:72-74` (tauri-security, 2/2 skeptics upheld)
- **What:** render_song takes total_ms (f64) and sample_rate (u32) straight from the IPC caller and computes total_samples with no upper bound, then render_offline immediately does vec![0.0f32; total_samples] (audio.rs:934). The legitimate caller (exportSong.ts) passes a bounded song duration, but IPC commands are callable by anything running in the webview. A single invoke('render_song', { events: [], totalMs: 1e15, sampleRate: 4000000000 }) forces a multi-terabyte allocation and either OOM-aborts the app (losing unsaved work) or hangs it. Reachable trivially once any script executes (compounding the CSP finding). Note events themselves are bounded by the Vec deserialization, but the sample count is not.
- **Evidence:** let sr = sample_rate.max(8_000) as f32;
let total_samples = ((total_ms.max(0.0) / 1000.0) * sr as f64).ceil() as usize;
... audio.rs:934: let mut out = vec![0.0f32; total_samples];
- **Fix:** Clamp both inputs to sane maxima before allocating, e.g. let sr = sample_rate.clamp(8_000, 192_000); and cap the duration: let total_ms = total_ms.clamp(0.0, 30.0 * 60.0 * 1000.0); (30 min ceiling) — or bound total_samples directly (e.g. sr as usize * 60 * 60) and return Err("song too long") past the limit rather than allocating. Also consider Vec::try_reserve to fail gracefully instead of aborting.

#### 24. [low] Image import derives MIME type from the file extension of a user-picked path with a silent image/png fallback
- **Where:** `src/useVideo.ts:102-104` (tauri-security, 2/2 skeptics upheld)
- **What:** importImages maps the extension of a dialog-selected path to a MIME type via EXT_MIME with a fallback of image/png, then wraps the raw bytes in a Blob with that type and later feeds it to URL.createObjectURL for rendering. The path is user-picked (low risk of attacker control) and blob: URLs are same-origin, so this is not an injection vector on its own, but the extension-driven MIME with a hard image/png fallback means a non-image file selected (or renamed) will be treated as an image and rendered/exported, and the content type is never validated against the bytes. Minor robustness/trust smell rather than an exploitable hole.
- **Evidence:** const mimeType = EXT_MIME[extOf(path)] ?? "image/png";
const key = newImageKey();
await putBlob(key, new Blob([await readFile(path)], { type: mimeType }));
- **Fix:** Constrain the open() dialog to the supported IMAGE_EXTS (already done) and, for defense in depth, sniff the leading magic bytes to confirm the blob is actually a supported image before storing/rendering, rather than trusting the extension with an image/png fallback.

#### 25. [low] parseProjectBundle validates only the top-level shape; malformed tracks/recordings reach remapProject and throw a raw TypeError
- **Where:** `src/songProject.ts:84-102, 136-144` (data-integrity, 2/2 skeptics upheld)
- **What:** parseProjectBundle checks only that b.song.tracks and b.recordings are arrays, then casts `b as ProjectBundle`. It does not verify that each track has a clips array or that each recordings entry is a non-null object. remapProject then does bundle.song.tracks.map(t => ({... clips: t.clips.map(...)})) and destructures each recording. A hostile/corrupt .mwsong with a track missing `clips`, or a null entry in `recordings`, throws `TypeError: Cannot read properties of undefined (reading 'map')` / `... of null (reading 'id')` inside remap. It is caught by SongView's try/catch so it surfaces as a generic 'Import failed', but validation should reject it in the parser with the friendly error the module promises, not rely on a downstream throw.
- **Evidence:** if (!b.song || !Array.isArray(b.song.tracks) || !Array.isArray(b.recordings)) throw ...
return b as ProjectBundle;   // no per-track / per-recording check
// remapProject:
tracks: bundle.song.tracks.map((t) => ({ ...t, id: newId(), clips: t.clips.map((c) => ...) }))
// Reproduced: a track with no `clips` -> TypeError in .map; a null in `recordings` -> TypeError reading 'id'
- **Fix:** In parseProjectBundle, validate every track (object with a clips array) and every recordings entry (object with a string id and an array events) before returning; throw the friendly Error on the first violation. Same for parseVideoBundle's images entries.

#### 26. [low] A recording with a non-array `events` (or a clip referencing an unknown recordingId) is silently accepted and persisted
- **Where:** `src/songProject.ts:119-142` (data-integrity, 2/2 skeptics upheld)
- **What:** remapProject copies each recording with `{ ...rec, id: newRecId, audio }` without validating `events`. A bundle whose recording has `events: "not-an-array"` (or missing events) round-trips through remap unchanged and is then handed to onAddRecordings and written into the persisted library. Later flattenClip does `[...rec.events].filter(...)` — spreading a string yields per-char entries and the filter/sort silently produces garbage rather than the intended stream, so a corrupt take poisons the library. Separately, a clip whose recordingId is not in the bundle keeps its foreign id via `recIdMap.get(c.recordingId) ?? c.recordingId`, producing a permanently dangling clip. Neither is caught because both are structurally 'valid enough' to pass the shallow parser.
- **Evidence:** const { audioBase64, ...rec } = er;              // events copied verbatim, unchecked
recordings.push({ ...rec, id: newRecId, audio });
// clip rewire falls back to the FOREIGN id when unmapped:
recordingId: recIdMap.get(c.recordingId) ?? c.recordingId,
- **Fix:** Validate/normalise events to an array (default []) during remap or in the parser, and drop (or reject) clips whose recordingId is absent from the bundle rather than keeping a foreign id.

#### 27. [low] Voice take exported with a missing blob re-imports pointing at a stale, non-existent blobKey (silent audio loss)
- **Where:** `src/songProject.ts:66-72, 122-129` (data-integrity, 2/2 skeptics upheld)
- **What:** buildProjectBundle sets audioBase64 only when getBlob returns a blob; if the blob is already gone it pushes the recording with audioBase64 undefined but leaves rec.audio pointing at the OLD blobKey. On re-import remapProject's guard `rec.kind === 'voice' && rec.audio && audioBase64` is false, so it keeps `audio = rec.audio` with the original blobKey — a key that does not exist in the importing machine's IndexedDB. Playback degrades gracefully (loadVoiceBuffer returns null → silence), so it is not a crash, but the imported voice clip is permanently silent with no warning, and the stale foreign blobKey is now persisted in this library.
- **Evidence:** const audioBase64 = blob ? bytesToBase64(...) : undefined;
recordings.push({ ...r, audioBase64 });        // audio still has the OLD blobKey
// remap keeps the stale key when audioBase64 is missing:
let audio = rec.audio;
if (rec.kind === "voice" && rec.audio && audioBase64) { audio = { ...rec.audio, blobKey: key }; ... }
- **Fix:** When a voice recording's audio can't be embedded (blob missing at export), either drop rec.audio / mark the take unavailable in the bundle, or on import clear the blobKey so the recording is clearly audioless rather than referencing a foreign key.

#### 28. [low] Cross-store commits are non-atomic: import can persist blobs/recordings without the song (or vice-versa)
- **Where:** `src/SongView.tsx:272-274` (data-integrity, 2/2 skeptics upheld)
- **What:** A project import touches three independent persistence stores with no transaction: importProjectBundle writes voice blobs to IndexedDB, then onAddRecordings (useRecorder → localStorage 'musicware.recordings.v1') runs on its own effect, then importSong (useArrangement → localStorage 'musicware.songs.v1') runs on its own effect. A crash/close between these commits leaves the library in a torn state — recordings without the song that references them, or (for video import via addSongToLibrary, which reads+rewrites the songs key directly) a song whose recordings weren't saved, i.e. dangling clips. flattenArrangement skips dangling clips so it won't crash, but the imported project is silently incomplete. This is inherent to the split localStorage/IndexedDB stores and there is no reconciliation on next load.
- **Evidence:** const { song, recordings: imported } = await importProjectBundle(bundle); // blobs already written to IDB
onAddRecordings(imported);   // persisted by a separate useEffect in useRecorder
importSong(song);            // persisted by a separate useEffect in useArrangement
- **Fix:** Commit the recordings first and the song only after, and/or add a startup reconcile that prunes clips whose recordingId is absent and recordings whose blobKey is missing. At minimum document the ordering guarantee.

#### 29. [low] openDB caches a rejected promise and getBlob has no onabort handler (possible permanent failure / hang)
- **Where:** `src/voiceStore.ts:18-31, 50-59` (data-integrity, 2/2 skeptics upheld)
- **What:** openDB memoises dbPromise; if the very first indexedDB.open fails (onerror), the rejected promise is cached forever and every later putBlob/getBlob/deleteBlob re-rejects without ever retrying the open — voice/image storage is permanently dead for the session even if the transient cause cleared. Separately, getBlob wires only req.onerror, not tx.onabort (unlike putBlob/deleteBlob which handle both). If a read transaction aborts (e.g. during a version-change while another tab upgrades), the getBlob promise never settles and its awaiter hangs.
- **Evidence:** if (!dbPromise) { dbPromise = new Promise(... req.onerror = () => reject(req.error); ...); }
return dbPromise;   // a rejected promise is cached and reused
// getBlob: no onabort
req.onsuccess = () => resolve(...); req.onerror = () => reject(req.error);
- **Fix:** On open failure, null out dbPromise before rejecting so a later call retries; add tx.onabort in getBlob to reject (or resolve null) so awaiters never hang.

#### 30. [low] Song and Video exports are guarded only by component-local flags, so a synth export and a video export can run concurrently
- **Where:** `src/SongView.tsx:211-221` (web-audio-export, 2/2 skeptics upheld)
- **What:** Overlapping exports within a single view are prevented (SongView disables the export button on `exporting`, VideoView on `busy`). But the guards are independent component state, and renderMixedSong is also invoked from VideoView's handleExportVideo. There is no cross-cutting lock, so a user on the Song tab exporting WAV and then switching to Video and exporting can have two OfflineAudioContext/AudioContext renders in flight simultaneously, doubling peak memory and both hitting the shared bufferCache/live AudioContext. Not a correctness bug (each render is independent), but a resource spike worth noting.
- **Evidence:** setExporting(true);
try {
  const bytes = await renderSongFile(arrangement, recordings, format);
  ...
} finally {
  setExporting(false);
}
// VideoView.handleExportVideo independently: setBusy(true) ... await renderMixedSong(...)
- **Fix:** If concurrent exports are undesirable, lift the busy flag to a shared context/store so any in-progress export disables all export entry points; otherwise document that concurrent exports are intentionally allowed.

#### 31. [low] useVideo object-URL effect revokes and recreates ALL image URLs whenever the image set changes
- **Where:** `src/useVideo.ts:66-85` (react-lifecycle, 2/2 skeptics upheld)
- **What:** The effect is keyed on imageKeysSig (the joined imageKey list). Adding/removing/reordering an image changes the signature, so the effect's cleanup runs first and revokes every URL in the previous run's `urls` map — including the ones for images that did NOT change — then the async IIFE recreates a brand-new URL for every image and only calls setImageUrls after the loop resolves. Consequences: (1) all thumbnails re-create their object URLs on every import (needless churn), and (2) between the synchronous revoke in cleanup and the async setImageUrls, imageUrls state still holds the just-revoked URLs, so mounted <img src={oldUrl}> in VideoView renders a revoked (broken) URL for a frame. Reorder in particular changes the join order and thus re-runs the whole effect even though the same blobs are involved. Not a leak (revocation is symmetric) — a churn/flicker smell.
- **Evidence:** const imageKeysSig = project.images.map((i) => i.imageKey).join(",");
  ...
  return () => {
      cancelled = true;
      for (const u of Object.values(urls)) URL.revokeObjectURL(u);
    };
- **Fix:** Track URLs in a ref keyed by imageKey and diff: create URLs only for keys that are new, revoke only keys that disappeared, and key the effect on the SET of keys (e.g. a sorted set) so pure reorders don't churn. Or move to a per-image lazy URL creation. This also removes the revoked-src flash.

#### 32. [low] VideoView async handlers setState after the component may have unmounted
- **Where:** `src/VideoView.tsx:55-167` (react-lifecycle, 2/2 skeptics upheld)
- **What:** handleSaveProject, handleOpenProject and handleExportVideo are long async flows (file dialogs, fs reads/writes, real-time video recording that literally plays in real time — see handleExportVideo's onProgress) that call setBusy/setStatusMsg/setSelectedImageId in their bodies and finally blocks. If the user switches away from Video mode (App unmounts VideoView) mid-export, these setState calls land on an unmounted component. React 18 no-ops such updates (no crash), but there is no isMounted/AbortController guard and the export in particular can run for many seconds, so the window is real. Low severity because it can't corrupt state or crash — worth noting only because the export is unusually long-lived.
- **Evidence:** setStatusMsg("Rendering video… (plays in real time)");
    try { ... await recordVideo({ ... onProgress: (f) => setStatusMsg(`Rendering video… ${Math.round(f * 100)}%`) });
      ...
      setStatusMsg(`Exported ${ext.toUpperCase()} video ✓`);
    } ... finally { setBusy(false); }
- **Fix:** Guard the post-await setState calls with an isMounted ref (set false in an unmount cleanup) or thread an AbortSignal into recordVideo so the in-flight export is torn down when VideoView unmounts.

#### 33. [low] Master volume slider announces raw 0–1 value, not the visible percentage
- **Where:** `src/VolumeControl.tsx:56-65, 75` (ux-a11y, 2/2 skeptics upheld)
- **What:** The range input is min=0 max=1 step=0.01 with aria-label="Volume level" and no aria-valuetext. Screen readers announce "0.6" / "0.61" while the sighted label shows "60%". The mismatch is confusing and the fractional values read awkwardly. The −/+ buttons are correctly labeled.
- **Evidence:** <input type="range" min={0} max={1} step={0.01} value={level} aria-label="Volume level" ... />
<span className="vol-pct">{pct}%</span>  // no aria-valuetext bridging the two
- **Fix:** Add aria-valuetext={`${pct}%`} to the range input so the announced value matches the visible percentage.

#### 34. [low] Marquee box-select has no keyboard equivalent
- **Where:** `src/Timeline.tsx:571-604 (handleMarqueeDown)` (ux-a11y, 2/2 skeptics upheld)
- **What:** Rubber-band multi-select is pointer-only (onPointerDown on .timeline-tracks). There is no keyboard gesture to select a range of clips at once. This is mitigated because single clips are focusable buttons and Shift/Ctrl+click is emulated by Shift+Enter on a focused clip (onClick reads e.shiftKey), so additive selection IS reachable one clip at a time, and the selection-bar (SongView.tsx:374) exposes group Duplicate/Delete/Clear. So the marquee is a convenience, not the only path — hence low, not high.
- **Evidence:** const handleMarqueeDown = (e: React.PointerEvent) => { if (e.button !== 0) return; ... selection.onMarqueeSelect(marqueeSelection(m, boxes), additive); }  // pointer only; onClick={(e)=>onSelectClip(clip.id, e.shiftKey||e.metaKey||e.ctrlKey)} gives the keyboard fallback
- **Fix:** Optional: add "select all in track" / "select all" keyboard shortcuts (e.g. Ctrl+A within the timeline region) so range-select isn't purely a mouse affordance; document the Shift+Enter additive path.

#### 35. [low] ClipShelf keyboard placement (keys 1/2/3) can only reach the first three tracks
- **Where:** `src/ClipShelf.tsx:37-45` (ux-a11y, 2/2 skeptics upheld)
- **What:** Focused clip cards accept 1/2/3 (and Enter/Space=lane 1) to place onto a track. Arrangements can have more than three tracks (addTrack is unbounded), so tracks 4+ have no keyboard placement target — those cards can only be dropped by mouse drag onto the later lanes. The aria-label also hard-codes "press 1, 2, or 3" regardless of track count.
- **Evidence:** if (e.key === "1" || e.key === "2" || e.key === "3") { placeOnLane(rec, Number(e.key) - 1); }
aria-label={`${rec.name}, ... press 1, 2, or 3 to place on a track.`}
- **Fix:** After placing on lane 1 via Enter, allow moving the placed clip between tracks by keyboard, or expose a small "place on track ▾" menu; at minimum make the aria-label reflect the real number of available lanes.

#### 36. [low] Destructive confirm/delete actions drop focus to <body> after the element unmounts
- **Where:** `src/TrackHeader.tsx:131-143 (Yes/No), 146-154 (delete → confirm)` (ux-a11y, 2/2 skeptics upheld)
- **What:** TrackHeader delete flows through an inline Yes/No: clicking ✕ swaps to Yes/No (focus stays), then clicking Yes removes the track and the Yes button unmounts, so keyboard focus falls to document.body with nothing to anchor a keyboard user. The same pattern applies to SongBar delete (SongBar.tsx:108-135) and per-clip × (Timeline.tsx:267-278). No focus is programmatically re-homed to a sensible sibling (e.g. the next track header or the Add-track button). Common in React apps, hence low, but it's a genuine keyboard-flow snag after every delete.
- **Evidence:** onClick={() => { setConfirming(false); onRemove(track.id); }}  // the button hosting this click is removed with the track; no focus() follow-up
- **Fix:** After a delete, move focus to a stable neighbour (next/previous track header, or the "+ Add track" button). A ref + focus() in a useEffect keyed on the track list, or focusing the container, prevents the focus-to-body drop.

#### 37. [low] Window pointer listeners (marquee, ruler seek/loop, clip trim) leak on unmount mid-drag
- **Where:** `src/Timeline.tsx:162-163, 504-505, 602-603` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** All three interactive drags register window-level pointermove/pointerup listeners in the pointerdown handler and remove them ONLY inside their own onUp. None register a React cleanup (useEffect return / AbortController). If the component unmounts while a drag is in flight (HMR, switching the top-bar mode away from Song, selectSong/newSong re-rendering the tree, or a route change), onUp never runs and the listeners persist, holding stale closures over detached DOM (container/rect refs) and, for the marquee, a detached tracksRef. A late pointerup then runs onUp against a removed container (querySelectorAll on a detached node) or calls setState on an unmounted component.
- **Evidence:** Marquee: `window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);` (602-603) removed only in onUp (589-590). Same shape for the ruler (504-505 / 494-495) and the trim handler (162-163 / 158-159). No useEffect cleanup references these listeners.
- **Fix:** Attach the drag listeners via an AbortController and abort it in a useEffect cleanup, or track the active drag in a ref and remove its listeners on unmount. Guard onUp's DOM access with a container-still-connected check (container.isConnected).

#### 38. [low] The voice-clip loop/seek scheduling path in play() is untested
- **Where:** `src/useArrangement.ts:291-320` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** The freshest Slice 7b glue — the voice (audio) pass that maps voiceClipPlays through the seek/loop transform (skip-before-origin, in-region [start,end) gating, per-cycle re-trigger, endMs accumulation) — has no test. useArrangement.test.tsx exercises seek/loop only for the SYMBOLIC stream (note_on timing, playLoopLenMs, isPlaying) and its single 'voice' mention (line 213) is just a comment. So the mid-window drop boundary, the loopCount×cycles nesting, and the endMs math for voice clips are entirely unguarded, which is exactly where findings above live.
- **Evidence:** grep 'voice|Voice' src/useArrangement.test.tsx returns only line 213's comment `// (no stranded voice)`. The seek/loop describe block (lines 165-210) uses makeRec (a keyboard take with symbolic events), never a voiceRec / audio clip, so voiceClipPlays returns [] in every play() test.
- **Fix:** Add tests that place a voice clip (kind:'voice', audio:{...}) and assert: (a) seek before its start drops it, at/after keeps it; (b) a loop region re-triggers it per cycle; (c) endMs/isPlaying span the voice tail. Mock voiceAudio's loadVoiceBuffer/playVoice (as voiceAudio.test.ts already does) to observe scheduled starts.

#### 39. [low] A tiny loop region can schedule up to 2000 × loopCount × (voice clips in region) setTimeout timers
- **Where:** `src/useArrangement.ts:278, 303-312` (new-slices-7b-8b, 2/2 skeptics upheld)
- **What:** The 2000 cap correctly bounds the symbolic stream size (max ~2000×totalEvents). But the voice pass nests the region cycle loop (up to cycles=2000 for a region <=300ms) inside each clip's loopCount, calling fireVoice — which allocates a setTimeout and pushes to voiceTimersRef — once per (k, c) pair. A 300ms loop over a handful of looped voice clips creates thousands of pending timers, each firing an async loadVoiceBuffer + playVoice within the tiny window. It is bounded (and torn down on stop), so not a crash, but it's a wasteful thundering-herd for a degenerate region a user can create by dragging a very short cycle bar.
- **Evidence:** `const cycles = useLoop ? Math.min(2000, Math.max(1, Math.ceil(600_000 / loopLen))) : 0;` (line 278) → 2000 for loopLen<=300. Voice: `for (let k = 0; k < vp.loopCount; k++) { ... for (let c = 0; c < cycles; c++) { ...; fireVoice(vp, at); } }` (303-312); fireVoice pushes a setTimeout per call (292-298).
- **Fix:** Cap the number of voice re-triggers per clip independently of the symbolic cycle count (e.g. stop scheduling a clip once at exceeds a sane horizon or the timer count crosses a threshold), or de-duplicate voice starts that fall within one buffer-length of each other.

#### 40. [nit] newId() truncates its random suffix to 6 base-36 chars; remap's 'collision-free' claim is probabilistic, not guaranteed
- **Where:** `src/recordings.ts:79-81` (data-integrity, 2/2 skeptics upheld)
- **What:** remapProject/importProjectBundle allocate every fresh id via newId() = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8). All ids minted inside one remap share the same Date.now() ms, so uniqueness rests entirely on the 6-char random suffix (36^6 ~ 2.18e9). The module docstring states import 'never collides', and neither remap nor the store dedups against existing library ids — nothing detects a collision if one occurred. Cross-time collisions are effectively impossible (differing ms), and intra-batch collision probability is tiny for realistic sizes (~0.0002% at 100 ids, ~0.02% at 1000), so this is low, but the guarantee is weaker than documented and unlike newBlobKey/newImageKey which keep the full-length random suffix.
- **Evidence:** export function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
// vs voiceStore.newBlobKey which does NOT truncate:
// "voice-" + Math.random().toString(36).slice(2) + Date.now().toString(36)
- **Fix:** Use crypto.randomUUID() (available in the Tauri WKWebView and modern test runtimes) or at least stop truncating the random suffix, matching newBlobKey. Optionally have remap verify generated ids don't collide with the current library before returning.

## Refuted (1)

- **Loop-toggle aria-pressed reflects the derived "looping" not the armed loopEnabled state** (`src/SongTransport.tsx`) - The finding's core scenario is unreachable. The loop button is disabled={!loopRegion} (SongTransport.tsx:78), so a user cannot toggle loopEnabled on while no region exists — the "toggled on but no region" state the finding describes cannot be produced via the button.

Moreover, region and enabled st

## Nits (3)

- eprintln! in the cpal error callback (I/O on the audio subsystem's error path) - `src-tauri/src/audio.rs:1251-1254` - Leave the atomic increment (the load-bearing signal) and consider gating the eprintln behind a debug build or a rate-limit, or drop it, so a sustained error stream can't repeatedly hit the stdout lock from the audio error callback.
- Timeline pointer-drag window listeners leak if the component unmounts mid-drag - `src/Timeline.tsx:162-163, 504-505, 602-603` - If ever observed in practice, register the active-drag listeners' teardown in a ref and clear it from a component-level useEffect unmount cleanup. Not worth changing otherwise.
- No consistent custom focus-visible ring; several controls rely solely on the UA default - `src/App.css:71-75 (button base), grep shows only .timeline-clip.selected/.trim define outline` - Add a single global rule: `:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }` to guarantee a high-contrast, consistent focus indicator across all interactive controls.

## Dimension summaries

### audio-scheduler (4 raised)
The SYMBOLIC scheduler is in strong shape and matches its documented invariants. flattenClip's per-window self-close, the dangling-off suppression, the per-note preset re-assert (ADR-0008 atomic brick), stable off-before-on ordering, and playArrangement.stop() releasing every sounding note together make the no-stranded-NOTE guarantee hold on the MIDI side — and it is thoroughly covered by the KA-1 adversarial regressions in arrangement.test.ts. I confirmed the engine-level basis of the DEBT-027 same-pitch limitation in src-tauri/src/audio.rs:780-790 (note_off releases every voice of a pitch, no per-voice id), so the scheduler's mitigations are correct and the documented limitations are honest. buildPlaybackStream seek/loop is safe (presets travel co-located with their notes, so seek/loop never strands a wrong-preset or unclosed note; the loop force-close is correct and monotonic). The genuine risks are ALL on the asynchronous VOICE (audio) path, which has NO generation/epoch guard and NO test coverage in useArrangement.test.tsx: (1) a voice buffer decoded during run A can attach to a newer run B across a stop→play boundary, playing stale audio; (2) the preview intent guard fails to detect a same-take re-click while its decode is still in flight, orphaning an unstoppable voice handle. Neither strands a held MIDI note, and both self-clear at the next stop or natural end, so they are wrong-behaviour bugs rather than data-loss/critical. Two lower-severity edge cases in the loop path round out the list.

### rt-audio-engine (3 raised)
The real-time audio engine (src-tauri/src/audio.rs) is in strong health and its core RT-safety invariants hold up under scrutiny. The cpal data callback is provably allocation-free and lock-free: voices live in a fixed `[Voice; 16]` stack pool, note events arrive over a pre-allocated SPSC ring buffer drained with `try_pop` (pure index math), the per-preset ADSR table is built once off-thread, and the whole callback body is wrapped in `assert_no_alloc` (active in debug/test). The `callback_hot_path_does_not_allocate` and `drum_render_does_not_allocate` tests exercise the real drain→render→volume→publish path under the no-alloc guard and pass. There are no `unwrap`/`expect`/panicking indexes, `Mutex` locks, or heap growth on the hot path; every array index (`PRESETS[v.preset]`, `adsr_table[..]`, drum/bell tables) is bounds-safe because `preset`/`volume` are clamped at the setter and `v.preset` is only ever set from a clamped value. Gain-staging is sound by construction: each voice contributes ≤ AMPLITUDE, the 16-voice sum × MASTER_GAIN (1/16) stays in [-AMPLITUDE, AMPLITUDE] for any phases/waveforms (verified for Square/Bell/Drums/additive worst cases in tests), and `apply_master_volume` hard-clamps to [-1,1] — no NaN/Inf can arise from the finite input chain, and Inf clamps correctly. Denormals are a non-issue: geometric tails either floor at ENV_FLOOR=1e-4 (envelope, drum_amp) or run only for the voice's bounded lifetime (bell_gain bottoms at ~1e-21, far above the ~1e-38 flush threshold). Voice stealing is deterministic (oldest-age min-scan) and unit-tested. The offline `render_offline` path faithfully reuses the exact live DSP (render_block/apply_event/ADSR table) and handles event times past the end via `.min(total_samples)`. The only findings are low-severity: a theoretical unbounded per-sample phase-wrap loop for out-of-range note numbers reachable only via direct IPC (not the clamped UI path), a deliberate-but-undocumented export-vs-live loudness divergence, and an `eprintln!` in the (non-render) error callback. No critical or high issues found.

### tauri-security (4 raised)
The Tauri security surface is a real, self-acknowledged pre-release debt. The single largest issue is the CSP in src-tauri/tauri.conf.json: it applies a dev-permissive policy — 'unsafe-inline' + 'unsafe-eval', plus ws:/wss:/http(s)://localhost:* connect sources — via default-src only, with no script-src of its own. In a WKWebView that also has broad fs read/write, any XSS becomes near-RCE-grade: injected script executes freely and can drive the fs and render_song IPC commands. The fs allow-list is also far wider than the features need — it grants read AND write to all of $HOME/**, $DOWNLOAD/**, $DESKTOP/**, $DOCUMENT/** as a standing scope, even though every real file operation uses a path the user just picked in a native save/open dialog (VideoView.tsx, SongView.tsx, useVideo.ts), which does not require a pre-declared scope. On the Rust side, render_song (lib.rs) turns caller-supplied total_ms/sample_rate straight into an unbounded vec![0.0f32; total_samples] allocation with no ceiling — a memory-exhaustion DoS reachable from any script in the webview. Good news: the mic path is understood and the required non-null CSP (media: blob: mediastream: data:) is present and must stay; there are no innerHTML/eval sinks in app code; and note/preset/volume inputs are all clamped in the engine. The whole surface can be tightened for distribution without touching the mic. None of these are exploitable without first getting script into the webview, so severities top out at high, but the CSP+fs combination is exactly what turns a small XSS into a serious one, so it should be fixed before public release.

### data-integrity (8 raised)
The serialization/persistence layer is in good shape on the happy path: the .mwsong / .mwvid bundle round-trips are correct (chunked base64 encode is stack-safe at the chosen 32768-byte chunk size; binary-safe decode), remap assigns fresh ids/blob-keys so a re-import is additive and does not overwrite existing songs/recordings, and all four localStorage stores tolerate corrupt/missing data by falling back to a safe default (backed by 88 passing tests across the 6 relevant files). No data-corruption or crash-the-app defect is reachable through the normal import UI, because SongView/VideoView wrap parse+remap in try/catch and surface a friendly message. The real weaknesses are (1) shallow validation of imported bundles: parseProjectBundle/parseVideoBundle only check the top-level shape, so a structurally-valid-but-internally-malformed bundle passes validation and then throws a raw TypeError deep inside remapProject (caught, but the guard belongs in the parser), and worse, a recording with a non-array events field is silently accepted and persisted into the library; (2) an unbounded IndexedDB blob leak — deleteBlob is never called anywhere, so every deleted voice take, removed video image, deleted song, and failed/partial import orphans its audio/image bytes forever; and (3) a latent lost-update risk between the independent song/recording/video stores (import writes blobs to IndexedDB before the metadata is committed, and addSongToLibrary bypasses the in-memory useArrangement list). None of these are silent data corruption of existing saved work, so nothing rises to critical, but the validation gap and the storage leak are worth fixing.

### web-audio-export (4 raised)
The three export/effect paths are structurally sound: the live AudioContext is a shared singleton (no per-preview leak), playVoice's cleanup is idempotent and disconnects every node + stops modulator oscillators, encodeWav/encodeMp3 are pure and correct, OfflineAudioContext.startRendering is called exactly once, and mono synth PCM up-mixing to the stereo destination is handled by Web Audio (no channel/sample-rate mismatch bug — decoded voice buffers at a different rate are resampled on playback, preserving pitch). Every decode/encode/render rejection propagates to a caller try/catch (SongView, VideoView), so there are no unhandled promise rejections, and export buttons are guarded by busy/exporting flags. The real problems are accumulating resource leaks in the video path: the canvas.captureStream video track (and audio MediaStreamDestination track) are never .stop()'d, so each video export orphans live MediaStreamTracks; the decoded-buffer cache grows unbounded and its cleanup API is dead code; and the OfflineAudioContext allocation is unclamped, so a pathologically long song can blow up memory. None are crashes or data loss, but the track leak accumulates across repeated video exports and is the most important to fix.

### react-lifecycle (4 raised)
Overall the hook/component lifecycle discipline in this codebase is strong and clearly deliberate: every hook that owns timers, media streams, players, rAF loops, or object URLs has a symmetric unmount cleanup (useRecorder 229-236, useVoiceRecorder 155-163, useArrangement 460-465, Playhead 51-54, Visualizer 78-81, Keyboard 127-141, useVideo 80-83). The "ref + empty-deps stable callback" pattern (setArrangement/setActiveProject reading activeIdRef, App's toggleRef/modeRef, useVoiceRecorder's recordingsRef/onSaveRef) is used consistently and correctly — those are intentional and I did not flag them. The window pointer-drag listeners in Timeline attach on pointerdown and remove on pointerup, the normal drag idiom. The one genuine correctness bug is an async preview race in useVoiceRecorder.preview, which — unlike its sibling useArrangement.previewRecording — lacks the intent-guard ref and can strand overlapping voice audio. Beyond that, only minor smells: the useVideo object-URL effect revokes/recreates every URL on any image-set change (transient thumbnail flicker + a frame of revoked src), and a couple of harmless setState-after-unmount windows during in-flight async in VideoView. No stuck-note, data-loss, or crash-class lifecycle defects found.

### ux-a11y (11 raised)
The Song/Voice/Video UI is markedly more accessible than typical DAW prototypes: clip blocks are fully keyboard-operable (focus + arrows/[/]/D/M/Del), track controls carry aria-label + aria-pressed, live regions announce shelf placement and export status, sr-only + prefers-reduced-motion are honoured, and hit targets on the in-clip toolbar are consistent. The systemic gap is the new Slice 7b/8b pointer interactions: the ruler is declared role="slider" yet is not focusable and has no key handler (a broken ARIA promise AND the only way to seek / set a loop region), and the marquee box-select, section move/resize, and clip edge-trim are all pointer-only. There is also a real keyboard-visibility bug — the SectionBand delete/suggest buttons reveal only on :hover with no :focus reveal, so a keyboard user lands focus on invisible controls — plus a couple of smaller ARIA/labeling issues. None are data-loss/crash class; the ruler slider and section-button visibility are the ones that block a keyboard-only user from real tasks.

### new-slices-7b-8b (6 raised)
Slice 7b (seek+loop) and Slice 8b (rubber-band) are largely sound where they matter most: the no-stranded-note invariant holds through buildPlaybackStream's loop branch (per-cycle force-close is correct), seek shifting and the playhead wrap math are right (elapsed % loopLen at elapsed==loopLen correctly returns the region start, no off-by-one), the 2000-cycle cap correctly bounds the SYMBOLIC stream at ~2000×totalEvents even for a sub-millisecond loopLen, and the documented voice mid-window drop is correctly bounded at the >= origin / [start,end) boundaries (it does not drop clips it shouldn't). The pure cores (arrangement.ts, marquee.ts, Playhead.ts) are well-tested. The real gaps are in the imperative glue that got the lightest review: (1) a confirmed stuck-state bug where the marquee's suppressClearRef never resets if a drag releases outside .timeline-tracks, swallowing the user's next click; (2) two voice-audio scheduling asymmetries in useArrangement.play() — voice buffers are NOT force-closed at a loop boundary (unlike symbolic notes) and the loop/offset math uses the recorded durationMs, ignoring the playbackRate effects (chipmunk/monster) that ADR-0009 explicitly says change played length; (3) window pointer listeners leak on unmount mid-drag; and (4) the voice-clip loop/seek path in play() is entirely untested. No crash / data-loss / stuck-MIDI-note issues found — the critical audio-safety guarantees survive adversarial probing.
