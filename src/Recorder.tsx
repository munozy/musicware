import { useEffect, useRef, useState } from "react";
import { useRecorder } from "./useRecorder";
import { formatDuration, type Recording } from "./recordings";

/**
 * Transport + library for keyboard compositions. Record arms the capture tap;
 * each take lands in a persisted list you can replay, rename, or delete (with a
 * brief undo window so a misclick on delete is recoverable).
 */
function Recorder() {
  const {
    recordings,
    isRecording,
    playingId,
    elapsedMs,
    pendingDelete,
    startRecording,
    stopRecording,
    play,
    stopPlayback,
    rename,
    remove,
    undoDelete,
  } = useRecorder();

  const recordBtnRef = useRef<HTMLButtonElement>(null);
  const undoBtnRef = useRef<HTMLButtonElement>(null);

  // After a delete, move focus to Undo so a keyboard user isn't stranded on the
  // removed row (WCAG 2.4.3) and can immediately recover.
  useEffect(() => {
    if (pendingDelete && document.activeElement !== undoBtnRef.current) {
      undoBtnRef.current?.focus();
    }
  }, [pendingDelete]);

  const handleUndo = () => {
    undoDelete();
    recordBtnRef.current?.focus(); // the toast is about to unmount — anchor focus
  };

  return (
    <section className="recorder" aria-label="Composition recorder">
      <div className="transport">
        <button
          ref={recordBtnRef}
          type="button"
          className={`rec-btn${isRecording ? " armed" : ""}`}
          aria-pressed={isRecording}
          aria-label={isRecording ? "Stop recording" : "Record"}
          onClick={isRecording ? stopRecording : startRecording}
        >
          <span className="rec-dot" aria-hidden="true" />
          {isRecording ? `Stop · ${formatDuration(elapsedMs)}` : "Record"}
        </button>
        <span className="rec-status" aria-live="polite">
          {isRecording ? "Recording — play the keyboard" : `${recordings.length} saved`}
        </span>
      </div>

      {recordings.length === 0 ? (
        <p className="rec-empty">No compositions yet — hit Record and play the keyboard.</p>
      ) : (
        <ul className="rec-list">
          {recordings.map((rec) => (
            <RecordingRow
              key={rec.id}
              rec={rec}
              isPlaying={playingId === rec.id}
              onPlay={() => play(rec.id)}
              onStop={stopPlayback}
              onRename={(name) => rename(rec.id, name)}
              onDelete={() => remove(rec.id)}
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
    </section>
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

  // Keep the draft in sync if the name changes from elsewhere while not editing.
  useEffect(() => {
    if (!editing) setDraft(rec.name);
  }, [rec.name, editing]);

  // On leaving edit mode (commit or cancel), restore focus to the name button.
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
    committedRef.current = true; // a following blur must not re-commit
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

export default Recorder;
