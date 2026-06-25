/**
 * ClipShelf — left panel listing saved Recordings as draggable source cards.
 * Drag payload: "clip:<recordingId>" on text/plain.
 * Keyboard fallback (Place on track) is deferred to Slice 2.
 */

import { formatDuration, type Recording } from "./recordings";

type Props = {
  recordings: Recording[];
};

export default function ClipShelf({ recordings }: Props) {
  const handleDragStart = (e: React.DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData("text/plain", `clip:${id}`);
    e.dataTransfer.effectAllowed = "copy";
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
              onDragStart={(e) => handleDragStart(e, rec.id)}
              title="Drag to the timeline"
            >
              <span className="clip-card-name">{rec.name}</span>
              <span className="clip-card-dur">{formatDuration(rec.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
