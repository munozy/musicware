import { type RefObject, useEffect, useRef, useState } from "react";
import { formatDuration, type Recording } from "./recordings";
import { type PendingDelete } from "./useRecorder";

/**
 * The compositions sidebar: the saved-take list + the undo toast. Presentational —
 * state comes from App's useRecorder. Replaces the take/Library half of the old
 * Recorder component.
 */
function Library({
  recordings,
  playingId,
  pendingDelete,
  onPlay,
  onStopPlay,
  onRename,
  onDelete,
  onUndo,
  recordBtnRef,
}: {
  recordings: Recording[];
  playingId: string | null;
  pendingDelete: PendingDelete | null;
  onPlay: (id: string) => void;
  onStopPlay: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUndo: () => void;
  recordBtnRef: RefObject<HTMLButtonElement | null>;
}) {
  const undoBtnRef = useRef<HTMLButtonElement>(null);

  // After a delete, move focus to Undo so a keyboard user isn't stranded on the
  // removed row (WCAG 2.4.3) and can immediately recover.
  useEffect(() => {
    if (pendingDelete && document.activeElement !== undoBtnRef.current) {
      undoBtnRef.current?.focus();
    }
  }, [pendingDelete]);

  const handleUndo = () => {
    onUndo();
    recordBtnRef.current?.focus(); // the toast is about to unmount — anchor focus
  };

  return (
    <aside className="library" aria-label="Compositions">
      <h2 className="library-title">Compositions</h2>

      {recordings.length === 0 ? (
        <p className="rec-empty">No takes yet — hit Record and play.</p>
      ) : (
        <ul className="rec-list">
          {recordings.map((rec) => (
            <RecordingRow
              key={rec.id}
              rec={rec}
              isPlaying={playingId === rec.id}
              onPlay={() => onPlay(rec.id)}
              onStop={onStopPlay}
              onRename={(name) => onRename(rec.id, name)}
              onDelete={() => onDelete(rec.id)}
            />
          ))}
        </ul>
      )}

      {pendingDelete && (
        <div className="rec-toast" role="status" aria-live="polite">
          <span>Deleted “{pendingDelete.recording.name}”</span>
          <button
            ref={undoBtnRef}
            type="button"
            className="rec-undo"
            aria-label={`Undo delete of ${pendingDelete.recording.name}`}
            onClick={handleUndo}
          >
            Undo
          </button>
        </div>
      )}
    </aside>
  );
}

function RecordingRow({
  rec,
  isPlaying,
  onPlay,
  onStop,
  onRename,
  onDelete,
}: {
  rec: Recording;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rec.name);
  // Enter fires commit AND then unmounting the input fires blur→commit; this guards
  // against the resulting double onRename. Reset when (re)entering edit mode.
  const committedRef = useRef(false);
  // Return focus to the name button when an edit ends (WCAG 2.4.3).
  const nameBtnRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(rec.name);
  }, [rec.name, editing]);

  useEffect(() => {
    if (wasEditingRef.current && !editing) nameBtnRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  const beginEdit = () => {
    committedRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const next = draft.trim();
    if (next && next !== rec.name) onRename(next);
    else setDraft(rec.name);
  };
  const cancel = () => {
    committedRef.current = true;
    setDraft(rec.name);
    setEditing(false);
  };

  return (
    <li className={`rec-row${isPlaying ? " playing" : ""}`}>
      <button
        type="button"
        className="rec-play"
        aria-label={`${isPlaying ? "Stop" : "Play"} ${rec.name}`}
        onClick={isPlaying ? onStop : onPlay}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      {editing ? (
        <input
          className="rec-name-edit"
          aria-label="New name"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") cancel();
          }}
        />
      ) : (
        <button
          ref={nameBtnRef}
          type="button"
          className="rec-name"
          aria-label={`Rename ${rec.name}`}
          title="Click to rename"
          onClick={beginEdit}
        >
          {rec.name}
        </button>
      )}

      <span className="rec-dur">{formatDuration(rec.durationMs)}</span>

      <button
        type="button"
        className="rec-del"
        aria-label={`Delete ${rec.name}`}
        onClick={onDelete}
      >
        ✕
      </button>
    </li>
  );
}

export default Library;
