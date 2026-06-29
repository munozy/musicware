/**
 * Song export (ADR-0009 follow-up). Renders the active song to one mixed stereo buffer and
 * encodes it to WAV or MP3:
 *   1. the SYNTH (keyboard clips) is rendered offline in Rust — exact engine sound
 *      (render_song command) — and returned as f32 PCM;
 *   2. that PCM + every VOICE clip (through its effect chain) are mixed in an
 *      OfflineAudioContext (voiceAudio.renderVoiceInto);
 *   3. the result is encoded — WAV (pure here) or MP3 (lamejs).
 * The save dialog + file write live in the caller (SongView), via the Tauri plugins.
 */

import { invoke } from "@tauri-apps/api/core";
import { Mp3Encoder } from "@breezystack/lamejs";
import { flattenArrangement, voiceClipPlays, type Arrangement } from "./arrangement";
import { loadVoiceBuffer, renderVoiceInto } from "./voiceAudio";
import type { Recording } from "./recordings";

export type ExportFormat = "wav" | "mp3";

const TAIL_MS = 1500; // let synth release tails ring out past the last note
const SAMPLE_RATE = 44_100;
const MP3_KBPS = 192;

/** Musical length of the song (ms): the later of the last symbolic event and any voice clip end. */
export function songDurationMs(arr: Arrangement, recordings: Recording[]): number {
  const events = flattenArrangement(arr, recordings);
  let end = events.length > 0 ? events[events.length - 1].t : 0;
  for (const vp of voiceClipPlays(arr, recordings)) {
    end = Math.max(end, vp.startMs + vp.loopCount * vp.durationMs);
  }
  return end;
}

/** True if the song has anything to export (at least one symbolic event or voice clip). */
export function songHasContent(arr: Arrangement, recordings: Recording[]): boolean {
  return flattenArrangement(arr, recordings).length > 0 || voiceClipPlays(arr, recordings).length > 0;
}

/** Render the active song (synth + voice clips + effects) to one mixed stereo AudioBuffer. */
export async function renderMixedSong(
  arr: Arrangement,
  recordings: Recording[],
  sampleRate = SAMPLE_RATE,
): Promise<AudioBuffer> {
  const events = flattenArrangement(arr, recordings);
  const voices = voiceClipPlays(arr, recordings);
  const totalMs = songDurationMs(arr, recordings) + TAIL_MS;
  const totalSamples = Math.max(1, Math.ceil((totalMs / 1000) * sampleRate));

  // 1) synth PCM from Rust (exact engine sound), returned as f32 LE bytes → Float32Array.
  const renderEvents = events.map((e) =>
    e.kind === "preset"
      ? { t: e.t, kind: "preset" as const, index: e.index }
      : { t: e.t, kind: e.kind, note: e.note },
  );
  const ab = await invoke<ArrayBuffer>("render_song", { events: renderEvents, totalMs, sampleRate });
  const synthPcm = new Float32Array(ab);

  // 2) offline mix: the synth + each voice clip through its effect chain.
  const ctx = new OfflineAudioContext(2, totalSamples, sampleRate);
  if (synthPcm.length > 0) {
    const synthBuf = ctx.createBuffer(1, synthPcm.length, sampleRate);
    synthBuf.copyToChannel(synthPcm, 0);
    const synthSrc = ctx.createBufferSource();
    synthSrc.buffer = synthBuf;
    synthSrc.connect(ctx.destination);
    synthSrc.start(0);
  }
  for (const vp of voices) {
    const buf = await loadVoiceBuffer(vp.blobKey);
    if (!buf) continue;
    for (let k = 0; k < vp.loopCount; k++) {
      renderVoiceInto(ctx, buf, vp.effect, (vp.startMs + k * vp.durationMs) / 1000);
    }
  }
  return ctx.startRendering();
}

/** Render the active song straight to encoded file bytes (WAV or MP3). */
export async function renderSongFile(
  arr: Arrangement,
  recordings: Recording[],
  format: ExportFormat,
): Promise<Uint8Array> {
  const mixed = await renderMixedSong(arr, recordings);
  const channels: Float32Array[] = [];
  for (let c = 0; c < mixed.numberOfChannels; c++) channels.push(mixed.getChannelData(c));
  return format === "wav" ? encodeWav(channels, mixed.sampleRate) : encodeMp3(channels, mixed.sampleRate);
}

function floatToInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Encode interleaved 16-bit PCM WAV from per-channel float data. Pure (no Web Audio). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = Math.max(1, channels.length);
  const numFrames = channels[0]?.length ?? 0;
  const blockAlign = numCh * 2; // 16-bit
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const i16 = channels.map(floatToInt16);
  let off = 44;
  for (let f = 0; f < numFrames; f++) {
    for (let c = 0; c < numCh; c++) {
      view.setInt16(off, i16[c][f], true);
      off += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Encode MP3 (lamejs) from per-channel float data. Mono or stereo. Pure (no Web Audio). */
export function encodeMp3(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = Math.min(2, Math.max(1, channels.length));
  const left = floatToInt16(channels[0] ?? new Float32Array(0));
  const right = numCh > 1 ? floatToInt16(channels[1]) : left;
  const enc = new Mp3Encoder(numCh, sampleRate, MP3_KBPS);
  const block = 1152;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const r = right.subarray(i, i + block);
    const chunk = numCh > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    if (chunk.length > 0) parts.push(chunk);
  }
  const tail = enc.flush();
  if (tail.length > 0) parts.push(tail);

  const total = parts.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of parts) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
