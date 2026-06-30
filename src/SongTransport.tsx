/**
 * SongTransport — Play/Stop + the grid/tempo controls (Slice 7).
 * BPM + beats-per-bar drive the timeline's bar/beat grid; Snap chooses what placements/moves
 * snap to. Changing tempo re-grids the ruler but does NOT move already-placed clips (US-25).
 */

import type { Recording } from "./recordings";
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
}: Props) {
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
      <span className="song-transport-status" aria-live="polite">
        {isPlaying ? "Playing" : "Stopped"}
      </span>

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
