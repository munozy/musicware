/**
 * SongView — song-mode shell. Composes ClipShelf (left), SongTransport (top),
 * and Timeline (centre). Owns nothing — wires useArrangement to children.
 *
 * If recordings is empty, shows the DESIGN-002 §9 interstitial.
 */

import { useArrangement } from "./useArrangement";
import ClipShelf from "./ClipShelf";
import Timeline from "./Timeline";
import SongTransport from "./SongTransport";
import type { Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onGoToPlay: () => void;
};

export default function SongView({ recordings, onGoToPlay }: Props) {
  const { arrangement, isPlaying, placeClip, moveClip, play, stop } = useArrangement();

  if (recordings.length === 0) {
    return (
      <div className="song-interstitial">
        <p>You haven&apos;t recorded anything yet.</p>
        <button
          className="song-go-record-btn"
          aria-label="Go record"
          onClick={onGoToPlay}
        >
          Go record →
        </button>
      </div>
    );
  }

  return (
    <div className="song-view">
      <SongTransport
        isPlaying={isPlaying}
        onPlay={play}
        onStop={stop}
        recordings={recordings}
      />
      <div className="song-body">
        <ClipShelf
          recordings={recordings}
          trackIds={arrangement.tracks.map((t) => t.id)}
          onPlaceClip={placeClip}
        />
        <Timeline
          arrangement={arrangement}
          recordings={recordings}
          isPlaying={isPlaying}
          onPlaceClip={placeClip}
          onMoveClip={moveClip}
        />
      </div>
    </div>
  );
}
