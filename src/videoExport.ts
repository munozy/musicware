/**
 * Video export (ADR-0010, stage 3) — render the slideshow + the song's mixed audio to a video
 * file IN the webview, no FFmpeg: draw frames to a <canvas>, capture it with captureStream(),
 * play the audio through a MediaStreamAudioDestinationNode, and record both with MediaRecorder.
 * Real-time (a clip takes its own length to render). MP4 if the webview supports it, else WebM.
 *
 * All Web-Media here is verified in-app (jsdom has no canvas.captureStream / MediaRecorder /
 * AudioContext). The pure timing helper `imageIndexAtMs` is unit-tested.
 */

export type VideoExportFormat = "mp4" | "webm";

/** Which image is on screen at `ms` (cumulative durations); holds the last image past the end. */
export function imageIndexAtMs(durationsMs: number[], ms: number): number {
  if (durationsMs.length === 0) return -1;
  let acc = 0;
  for (let i = 0; i < durationsMs.length; i++) {
    acc += durationsMs[i];
    if (ms < acc) return i;
  }
  return durationsMs.length - 1;
}

/** Pick the best MediaRecorder container/codec the webview supports (MP4 preferred). null if none. */
export function pickVideoMime(): { mime: string; ext: VideoExportFormat } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: { mime: string; ext: VideoExportFormat }[] = [
    { mime: "video/mp4;codecs=h264,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

type ImageInput = { url: string; durationMs: number };

/**
 * Record the slideshow + audio to a video Blob, in real time. Resolves with the encoded bytes
 * and the actual container extension (mp4 or webm, depending on webview support).
 */
export async function recordVideo(opts: {
  images: ImageInput[];
  audioBuffer: AudioBuffer | null;
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (fraction: number) => void;
}): Promise<{ blob: Blob; ext: VideoExportFormat }> {
  const { images, audioBuffer, durationMs, width = 1280, height = 720, fps = 30, onProgress } = opts;
  const picked = pickVideoMime();
  if (!picked) throw new Error("This build can't record video (no MediaRecorder support).");

  const imgs = await Promise.all(images.map((i) => loadImage(i.url)));
  const durations = images.map((i) => i.durationMs);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't create a drawing canvas.");

  const drawFrame = (ms: number) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const idx = imageIndexAtMs(durations, ms);
    const img = idx >= 0 ? imgs[idx] : null;
    if (img) {
      const scale = Math.min(width / img.width, height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }
  };
  drawFrame(0);

  const videoStream = canvas.captureStream(fps);
  const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  let audioCtx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  if (audioBuffer) {
    audioCtx = new AudioContext();
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    source.connect(audioCtx.destination); // also play it aloud so the export gives feedback
    tracks.push(...dest.stream.getAudioTracks());
  }

  const stream = new MediaStream(tracks);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: picked.mime }));
  });

  recorder.start();
  const start = performance.now();
  source?.start();

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - start;
      drawFrame(elapsed);
      onProgress?.(Math.min(1, elapsed / durationMs));
      if (elapsed >= durationMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  try {
    source?.stop();
  } catch {
    /* already stopped */
  }
  recorder.stop();
  const blob = await finished;
  try {
    await audioCtx?.close();
  } catch {
    /* ignore */
  }
  return { blob, ext: picked.ext };
}
