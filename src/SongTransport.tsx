/**
 * SongTransport — Play/Stop buttons for the arrangement.
 * Slice 1: Play (▶) + Stop (■) + elapsed readout. Tempo/loop deferred to Slice 7.
 */

import type { Recording } from "./recordings";

type Props = {
  isPlaying: boolean;
  onPlay: (recordings: Recording[]) => void;
  onStop: () => void;
  recordings: Recording[];
};

export default function SongTransport({ isPlaying, onPlay, onStop, recordings }: Props) {
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
      <button
        className="song-transport-btn"
        aria-label="Stop"
        onClick={onStop}
        disabled={!isPlaying}
      >
        ■
      </button>
      <span className="song-transport-status" aria-live="polite">
        {isPlaying ? "Playing" : "Stopped"}
      </span>
    </div>
  );
}
