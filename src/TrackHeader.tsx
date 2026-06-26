/**
 * TrackHeader — per-track controls in the timeline (Slice 3, US-4/5/6/10):
 * reorder (↑/↓), rename (click → input, Enter commits / Escape cancels),
 * colour (swatch cycles the palette), delete (✕ → inline Yes/No confirm).
 * The last remaining track cannot be deleted.
 */

import { useState } from "react";
import type { Track } from "./arrangement";
import { TRACK_PALETTE } from "./arrangementStore";

type Props = {
  track: Track;
  index: number;
  trackCount: number;
  onRename: (trackId: string, name: string) => void;
  onSetColor: (trackId: string, color: string) => void;
  onReorder: (trackId: string, dir: "up" | "down") => void;
  onRemove: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
};

export default function TrackHeader({
  track,
  index,
  trackCount,
  onRename,
  onSetColor,
  onReorder,
  onRemove,
  onToggleMute,
  onToggleSolo,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  const [confirming, setConfirming] = useState(false);

  const startEdit = () => {
    setDraft(track.name);
    setEditing(true);
  };
  const commit = () => {
    onRename(track.id, draft);
    setEditing(false);
  };

  const cycleColor = () => {
    const i = TRACK_PALETTE.indexOf(track.color);
    const next = TRACK_PALETTE[(i + 1) % TRACK_PALETTE.length] ?? TRACK_PALETTE[0];
    onSetColor(track.id, next);
  };

  const canRemove = trackCount > 1;

  return (
    <div className="track-header" style={{ borderLeftColor: track.color }}>
      <span className="track-reorder">
        <button
          className="track-btn"
          aria-label={`Move ${track.name} up`}
          disabled={index === 0}
          onClick={() => onReorder(track.id, "up")}
        >
          ↑
        </button>
        <button
          className="track-btn"
          aria-label={`Move ${track.name} down`}
          disabled={index === trackCount - 1}
          onClick={() => onReorder(track.id, "down")}
        >
          ↓
        </button>
      </span>

      {editing ? (
        <input
          className="track-name-input"
          autoFocus
          value={draft}
          aria-label="Track name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className="track-name" onClick={startEdit} aria-label={`Rename track ${track.name}`}>
          {track.name}
        </button>
      )}

      <button
        className="track-color-swatch"
        style={{ background: track.color }}
        aria-label={`Change colour of ${track.name}`}
        onClick={cycleColor}
      />

      <button
        className={`track-btn track-mute${track.muted ? " active" : ""}`}
        aria-pressed={track.muted}
        aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
        title="Mute"
        onClick={() => onToggleMute(track.id)}
      >
        M
      </button>
      <button
        className={`track-btn track-solo${track.soloed ? " active" : ""}`}
        aria-pressed={track.soloed}
        aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`}
        title="Solo"
        onClick={() => onToggleSolo(track.id)}
      >
        S
      </button>

      {confirming ? (
        <span className="track-delete-confirm">
          <span className="track-confirm-label">Remove?</span>
          <button
            className="track-btn track-confirm-yes"
            aria-label={`Confirm remove ${track.name}`}
            onClick={() => {
              setConfirming(false);
              onRemove(track.id);
            }}
          >
            Yes
          </button>
          <button className="track-btn" aria-label="Cancel remove" onClick={() => setConfirming(false)}>
            No
          </button>
        </span>
      ) : (
        <button
          className="track-btn track-delete"
          aria-label={`Remove ${track.name}`}
          disabled={!canRemove}
          title={canRemove ? "Remove track" : "Keep at least one track"}
          onClick={() => setConfirming(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}
