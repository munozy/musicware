# ADR-0010 — Video-clip composer (song + images → MP4)

- **Status:** Accepted (2026-06-29). Reduced-bar caveat: implemented inline (org API spend limit
  blocks the adversarial review + Council); a re-review is owed (DEBT-034). Builds on ADR-0009 (audio
  assets) and the song-render/export pipeline.
- **Context owner:** a new Video section (`videoStore.ts`, `useVideo.ts`, `VideoView.tsx`) + the MP4 export.

## Context

Users want to make a simple **video clip**: pick one of their saved **songs** as the soundtrack and one
or more **images**, arranged as a slideshow over the song, then export an actual video file. CRUD +
save/open project + export, mirroring the song workflow.

## Decision

A dedicated **Video** section (4th top-bar mode `[ Play | Voice | Song | Video ]`). A **video project** is:

```
VideoProject { id, name, createdAt, songId, images: VideoImage[] }
VideoImage   { id, name, imageKey, mimeType, durationMs }
```

- **Storage mirrors voice/songs:** the image bytes live in **IndexedDB** (too big for localStorage),
  keyed by `imageKey` (reusing the `voiceStore` blob KV); the project metadata lives in localStorage
  (`musicware.videoprojects.v1` + active id).
- **Soundtrack by reference:** a project references a saved song by `songId`; preview/export render that
  song's audio via the existing `renderMixedSong` (synth offline-render + voice mix).
- **Timing:** auto **even-split** slideshow by default (each image = songDuration / imageCount), with
  per-image durations adjustable. The video length is driven by the song; images that run out hold the
  last frame, images past the end are cut.
- **Export = MP4 in-app, no FFmpeg** (the chosen scope): draw the slideshow to a `<canvas>`,
  `canvas.captureStream()` for video, play the song's mixed audio through a
  `MediaStreamAudioDestinationNode` for audio, and record both with `MediaRecorder` → `.mp4`. Real-time
  (a 2-min clip takes ~2 min). Saved via the native dialog + fs plugins (already wired for audio export).
- **Save/Open project (`.mwvid`)** embeds the full song bundle (ADR-0009 `ProjectBundle`: arrangement +
  its recordings) **plus** the images (base64) + timing — so a video project is portable and reconstructs
  exactly, reusing `songProject`'s build/import + id-remap.

## Consequences

- **(+) No heavy dependency / app stays small** — canvas + MediaRecorder are built-in; reuses the audio
  render + the dialog/fs plugins + the IndexedDB blob store.
- **(+) Portable projects** — `.mwvid` is self-contained (song + recordings + images embedded).
- **(−) MP4 only, real-time export** — no AVI (would need FFmpeg, explicitly out of scope), and a clip
  takes its own length to render. `MediaRecorder` mp4 support in the WKWebView is the feasibility gate,
  proven by the first in-app export (fallback: webm).
- **(−) New storage surface** — image blobs accumulate in IndexedDB; deleting a project/image should free
  them (best-effort cleanup).

## Alternatives considered

- **WebCodecs + mp4-muxer** (offline, faster-than-realtime): more control but WebCodecs support in the
  WKWebView is uncertain and muxing adds complexity. Deferred; MediaRecorder is the simpler proven path.
- **Bundle FFmpeg (sidecar)** for MP4+AVI + fast/high-quality encode: tens of MB, build/licensing
  complexity. Rejected for V1 per the product decision (MP4-only, in-app).
