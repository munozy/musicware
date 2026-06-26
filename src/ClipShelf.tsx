/**
 * ClipShelf — left panel listing saved Recordings as source cards.
 * Pointer: drag a card to the timeline (payload "clip:<recordingId>" on text/plain).
 * Keyboard (Slice 2 / DEBT-034 #14): focus a card and press 1, 2, or 3 (or Enter = lane 1)
 * to place it at the start of that track. An aria-live region announces the placement.
 */

import { useState } from "react";
import { formatDuration, type Recording } from "./recordings";

type Props = {
  recordings: Recording[];
  /** Track ids in lane order — keyboard keys 1/2/3 map onto these. */
  trackIds: string[];
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
};

export default function ClipShelf({ recordings, trackIds, onPlaceClip }: Props) {
  const [announce, setAnnounce] = useState("");

  const handleDragStart = (e: React.DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData("text/plain", `clip:${id}`);
    e.dataTransfer.effectAllowed = "copy";
  };

  const placeOnLane = (rec: Recording, laneIndex: number) => {
    const trackId = trackIds[laneIndex];
    if (!trackId) return;
    onPlaceClip(trackId, rec.id, 0);
    setAnnounce(`Placed ${rec.name} on track ${laneIndex + 1}.`);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rec: Recording) => {
    if (e.key === "1" || e.key === "2" || e.key === "3") {
      e.preventDefault();
      placeOnLane(rec, Number(e.key) - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      placeOnLane(rec, 0); // Enter/Space = place on the first track
    }
  };

  return (
    <aside className="clip-shelf" aria-label="Clip shelf">
      <p className="clip-shelf-title">Recordings</p>
      {recordings.length === 0 ? (
        <p className="clip-shelf-empty">No recordings yet.</p>
      ) : (
        <ul className="clip-shelf-list">
          {recordings.map((rec) => (
            <li
              key={rec.id}
              className="clip-card"
              draggable
              tabIndex={0}
              role="button"
              aria-label={`${rec.name}, ${formatDuration(rec.durationMs)}. Drag to the timeline, or press 1, 2, or 3 to place on a track.`}
              onDragStart={(e) => handleDragStart(e, rec.id)}
              onKeyDown={(e) => handleKeyDown(e, rec)}
              title="Drag to the timeline, or press 1, 2 or 3"
            >
              <span className="clip-card-name">{rec.name}</span>
              <span className="clip-card-dur">{formatDuration(rec.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sr-only" aria-live="polite" data-testid="shelf-announce">
        {announce}
      </div>
    </aside>
  );
}
