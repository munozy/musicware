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
import SongBar from "./SongBar";
import type { Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  onGoToPlay: () => void;
};

export default function SongView({ recordings, onGoToPlay }: Props) {
  const {
    arrangement,
    songs,
    activeSongId,
    newSong,
    selectSong,
    renameSong,
    deleteSong,
    isPlaying,
    playStartedAt,
    previewingId,
    placeClip,
    moveClip,
    removeClip,
    addTrack,
    renameTrack,
    setTrackColor,
    reorderTrack,
    removeTrack,
    toggleMute,
    toggleSolo,
    toggleClipMute,
    duplicateClip,
    setClipLoop,
    transposeClip,
    trimClip,
    previewRecording,
    play,
    stop,
  } = useArrangement();

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
      <SongBar
        songs={songs.map((s) => ({ id: s.id, name: s.name }))}
        activeSongId={activeSongId}
        onSelect={selectSong}
        onNew={newSong}
        onRename={renameSong}
        onDelete={deleteSong}
      />
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
          onPreview={previewRecording}
          previewingId={previewingId}
        />
        <Timeline
          arrangement={arrangement}
          recordings={recordings}
          isPlaying={isPlaying}
          playStartedAt={playStartedAt}
          onPlaceClip={placeClip}
          clipOps={{
            onMoveClip: moveClip,
            onRemoveClip: removeClip,
            onToggleClipMute: toggleClipMute,
            onDuplicateClip: duplicateClip,
            onSetClipLoop: setClipLoop,
            onTransposeClip: transposeClip,
            onTrimClip: trimClip,
          }}
          trackOps={{
            onAddTrack: addTrack,
            onRenameTrack: renameTrack,
            onSetTrackColor: setTrackColor,
            onReorderTrack: reorderTrack,
            onRemoveTrack: removeTrack,
            onToggleMute: toggleMute,
            onToggleSolo: toggleSolo,
          }}
        />
      </div>
    </div>
  );
}
