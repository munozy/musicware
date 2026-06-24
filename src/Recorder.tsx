import { useEffect, useRef, useState } from "react";
import { useRecorder } from "./useRecorder";
import { formatDuration, type Recording } from "./recordings";

/**
 * Transport + library for keyboard compositions. Record arms the capture tap;
 * each take lands in a persisted list you can replay, rename, or delete.
 */
function Recorder() {
  const {
    recordings,
    isRecording,
    playingId,
    elapsedMs,
    startRecording,
    stopRecording,
    play,
    stopPlayback,
    rename,
    remove,
  } = useRecorder();

  return (
    <section className="recorder" aria-label="Composition recorder">
      <div className="transport">
        <button
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

  // Keep the draft in sync if the name changes from elsewhere while not editing.
  useEffect(() => {
    if (!editing) setDraft(rec.name);
  }, [rec.name, editing]);

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
