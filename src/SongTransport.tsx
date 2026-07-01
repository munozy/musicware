/**
 * SongTransport — Play/Stop + the grid/tempo controls (Slice 7).
 * BPM + beats-per-bar drive the timeline's bar/beat grid; Snap chooses what placements/moves
 * snap to. Changing tempo re-grids the ruler but does NOT move already-placed clips (US-25).
 */

import { formatDuration, type Recording } from "./recordings";
import type { SnapDivision } from "./timeScale";

type Props = {
  isPlaying: boolean;
  onPlay: (recordings: Recording[]) => void;
  onStop: () => void;
  recordings: Recording[];
  tempoBpm: number;
  beatsPerBar: number;
  snap: SnapDivision;
  onSetTempo: (bpm: number) => void;
  onSetBeatsPerBar: (beats: number) => void;
  onSetSnap: (d: SnapDivision) => void;
  // Seek + loop-region (Slice 7b)
  seekMs: number;
  loopRegion: { startMs: number; endMs: number } | null;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  onClearSeek: () => void;
  onClearLoop: () => void;
};

const SNAP_OPTIONS: { value: SnapDivision; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "bar", label: "Bar" },
  { value: "beat", label: "Beat" },
  { value: "half", label: "½ Beat" },
];

export default function SongTransport({
  isPlaying,
  onPlay,
  onStop,
  recordings,
  tempoBpm,
  beatsPerBar,
  snap,
  onSetTempo,
  onSetBeatsPerBar,
  onSetSnap,
  seekMs,
  loopRegion,
  loopEnabled,
  onToggleLoop,
  onClearSeek,
  onClearLoop,
}: Props) {
  const looping = loopEnabled && loopRegion != null && loopRegion.endMs > loopRegion.startMs;
  return (
    <div className="song-transport" role="group" aria-label="Song transport">
      <button
        className="song-transport-btn"
        aria-label="Play arrangement"
        onClick={() => onPlay(recordings)}
        disabled={isPlaying}
      >
        ▶
      </button>
      <button className="song-transport-btn" aria-label="Stop" onClick={onStop} disabled={!isPlaying}>
        ■
      </button>
      <button
        className={`song-transport-btn loop-toggle${looping ? " active" : ""}`}
        aria-label="Loop region"
        aria-pressed={looping}
        title={
          loopRegion
            ? "Loop the region (drag on the ruler to set it)"
            : "Drag on the ruler to set a loop region first"
        }
        disabled={!loopRegion}
        onClick={onToggleLoop}
      >
        🔁
      </button>
      <span className="song-transport-status" aria-live="polite">
        {isPlaying ? "Playing" : "Stopped"}
      </span>

      {looping ? (
        <span className="transport-region" title="Loop region — Play repeats this window">
          🔁 {formatDuration(loopRegion!.startMs)}–{formatDuration(loopRegion!.endMs)}
          <button className="transport-region-clear" aria-label="Clear loop region" onClick={onClearLoop}>
            ×
          </button>
        </span>
      ) : (
        seekMs > 0 && (
          <span className="transport-region" title="Play starts from here — click the ruler to move it">
            ↦ {formatDuration(seekMs)}
            <button className="transport-region-clear" aria-label="Clear seek" onClick={onClearSeek}>
              ×
            </button>
          </span>
        )
      )}

      <span className="transport-grid" title="Tempo re-grids the timeline; it doesn't move clips already placed.">
        <label className="transport-field">
          <span>BPM</span>
          <input
            className="transport-bpm"
            type="number"
            min={40}
            max={300}
            value={tempoBpm}
            aria-label="Tempo in BPM"
            onChange={(e) => onSetTempo(Number(e.target.value) || tempoBpm)}
          />
        </label>
        <label className="transport-field">
          <span>Beats/bar</span>
          <select
            className="transport-beats"
            value={beatsPerBar}
            aria-label="Beats per bar"
            onChange={(e) => onSetBeatsPerBar(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
        <label className="transport-field">
          <span>Snap</span>
          <select
            className="transport-snap"
            value={snap}
            aria-label="Snap to grid"
            onChange={(e) => onSetSnap(e.target.value as SnapDivision)}
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </span>
    </div>
  );
}
