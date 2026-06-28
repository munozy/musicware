/**
 * Voice playback + the funny-effects engine (ADR-0009) — pure Web Audio, no Rust.
 *
 * Effects are NON-DESTRUCTIVE: the take stores a dry Blob; the effect chain is built from
 * Web Audio nodes here at playback time, so a take's effect can change freely. Used by the
 * Voice-section preview now and the arrangement audio path next.
 *
 *   Distortion → WaveShaper · Chipmunk/Monster → playbackRate · Robot → ring-mod ·
 *   Echo → feedback Delay · Telephone → band-pass Biquad · Reverb → Convolver (generated IR)
 */

import type { VoiceEffect } from "./recordings";
import { getBlob } from "./voiceStore";

type WindowWithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

// Decoded buffers, cached by blobKey so re-preview / re-play doesn't re-decode.
const bufferCache = new Map<string, AudioBuffer>();

/** Decode a stored voice take to an AudioBuffer (cached). null if the blob is missing. */
export async function loadVoiceBuffer(blobKey: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(blobKey);
  if (cached) return cached;
  const blob = await getBlob(blobKey);
  if (!blob) return null;
  const arr = await blob.arrayBuffer();
  const buf = await audioCtx().decodeAudioData(arr);
  bufferCache.set(blobKey, buf);
  return buf;
}

/** Forget a cached buffer (call after deleting a take). */
export function clearVoiceBuffer(blobKey: string): void {
  bufferCache.delete(blobKey);
}

/** The playback-rate an effect imposes (1 = unchanged). Chipmunk/Monster shift pitch+speed. */
export function effectPlaybackRate(effect: VoiceEffect): number {
  if (effect === "chipmunk") return 1.6;
  if (effect === "monster") return 0.65;
  return 1;
}

function distortionCurve(amount = 600): Float32Array {
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function reverbImpulse(ac: AudioContext, seconds = 1.4, decay = 3): AudioBuffer {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export type VoiceHandle = { stop: () => void };

/**
 * Play a decoded voice buffer through the given effect chain. Returns a handle whose stop()
 * is idempotent and releases every node. `onEnded` fires on natural end or stop.
 */
export function playVoice(buffer: AudioBuffer, effect: VoiceEffect = "none", onEnded?: () => void): VoiceHandle {
  const ac = audioCtx();
  if (ac.state === "suspended") void ac.resume();

  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = effectPlaybackRate(effect);

  const nodes: AudioNode[] = []; // to disconnect on stop
  const stoppables: AudioScheduledSourceNode[] = [source]; // to stop() on cleanup
  let head: AudioNode = source; // current end of the serial chain
  const series = (node: AudioNode) => {
    head.connect(node);
    head = node;
    nodes.push(node);
  };

  switch (effect) {
    case "distortion": {
      const ws = ac.createWaveShaper();
      ws.curve = distortionCurve(600);
      ws.oversample = "4x";
      const makeup = ac.createGain();
      makeup.gain.value = 0.7; // tame the level the curve adds
      series(ws);
      series(makeup);
      break;
    }
    case "robot": {
      // Ring modulation: multiply the signal by a low-frequency carrier (gain base 0,
      // carrier swings it ±1) → metallic robot timbre.
      const ring = ac.createGain();
      ring.gain.value = 0;
      const carrier = ac.createOscillator();
      carrier.frequency.value = 60;
      carrier.connect(ring.gain);
      carrier.start();
      stoppables.push(carrier);
      series(ring);
      break;
    }
    case "echo": {
      const delay = ac.createDelay(1.0);
      delay.delayTime.value = 0.25;
      const feedback = ac.createGain();
      feedback.gain.value = 0.4;
      const wet = ac.createGain();
      wet.gain.value = 0.7;
      source.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay); // feedback loop
      delay.connect(wet);
      wet.connect(ac.destination);
      nodes.push(delay, feedback, wet);
      break; // head stays = source → dry path wired below
    }
    case "telephone": {
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500;
      bp.Q.value = 1.2;
      series(bp);
      break;
    }
    case "reverb": {
      const conv = ac.createConvolver();
      conv.buffer = reverbImpulse(ac);
      const wet = ac.createGain();
      wet.gain.value = 0.85;
      source.connect(conv);
      conv.connect(wet);
      wet.connect(ac.destination);
      nodes.push(conv, wet);
      break; // dry path wired below too
    }
    case "chipmunk":
    case "monster":
    case "none":
    default:
      break; // straight through (rate already set for chipmunk/monster)
  }

  head.connect(ac.destination);

  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const s of stoppables) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    try {
      source.disconnect();
    } catch {
      /* already gone */
    }
    onEnded?.();
  };

  source.onended = cleanup;
  source.start();
  return { stop: cleanup };
}
