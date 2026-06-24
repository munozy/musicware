import { useEffect, useState } from "react";
import { setVolume } from "./synth";

const STORAGE_KEY = "musicware.volume.v1";
const DEFAULT_LEVEL = 0.6; // matches DEFAULT_VOLUME in src-tauri/src/audio.rs
const STEP = 0.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function loadLevel(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_LEVEL;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

/**
 * Master volume: a slider plus −/+ step buttons. Pushes the level to the engine
 * (and persists it) on mount and on every change. Purely an output/monitor
 * setting — orthogonal to notes, presets, and recording.
 */
function VolumeControl() {
  const [level, setLevel] = useState<number>(loadLevel);

  useEffect(() => {
    setVolume(level);
    try {
      localStorage.setItem(STORAGE_KEY, String(level));
    } catch {
      /* ignore persistence failures */
    }
  }, [level]);

  // Round to avoid float drift from repeated stepping (0.1 + 0.2 ...).
  const apply = (v: number) => setLevel(clamp01(Number(v.toFixed(2))));
  const pct = Math.round(level * 100);

  return (
    <div className="volume" role="group" aria-label="Master volume">
      <span className="vol-icon" aria-hidden="true">
        🔊
      </span>
      <button
        type="button"
        className="vol-btn"
        aria-label="Lower volume"
        onClick={() => apply(level - STEP)}
        disabled={level <= 0}
      >
        −
      </button>
      <input
        type="range"
        className="vol-slider"
        min={0}
        max={1}
        step={0.01}
        value={level}
        aria-label="Volume level"
        onChange={(e) => apply(Number(e.target.value))}
      />
      <button
        type="button"
        className="vol-btn"
        aria-label="Raise volume"
        onClick={() => apply(level + STEP)}
        disabled={level >= 1}
      >
        +
      </button>
      <span className="vol-pct">{pct}%</span>
    </div>
  );
}

export default VolumeControl;
