import { type RefObject } from "react";
import { formatDuration } from "./recordings";

/**
 * The record control, for the top bar. Presentational — the recorder state lives
 * in App's useRecorder so the same instance also drives the sidebar Library.
 */
function Transport({
  recordBtnRef,
  isRecording,
  elapsedMs,
  savedCount,
  onStart,
  onStop,
}: {
  recordBtnRef: RefObject<HTMLButtonElement | null>;
  isRecording: boolean;
  elapsedMs: number;
  savedCount: number;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="transport">
      <button
        ref={recordBtnRef}
        type="button"
        className={`rec-btn${isRecording ? " armed" : ""}`}
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop recording" : "Record"}
        title={isRecording ? "Stop recording (Space)" : "Record (Space)"}
        onClick={isRecording ? onStop : onStart}
      >
        <span className="rec-dot" aria-hidden="true" />
        {isRecording ? `Stop · ${formatDuration(elapsedMs)}` : "Record"}
      </button>
      <span className="rec-shortcut" aria-hidden="true">
        <kbd>Space</kbd>
      </span>
      <span className="rec-status" aria-live="polite">
        {isRecording ? "Recording — play the keyboard" : `${savedCount} saved`}
      </span>
    </div>
  );
}

export default Transport;
