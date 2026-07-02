/**
 * VoiceView — the Voice section (ADR-0009). Record your voice, give a take a funny effect,
 * preview it. Takes live in the SHARED library (state comes from App's useRecorder +
 * useVoiceRecorder), so they also appear in the Song shelf. Presentational.
 */

import { useState } from "react";
import { formatDuration, VOICE_EFFECTS, type Recording, type VoiceEffect } from "./recordings";

type Props = {
  voiceTakes: Recording[];
  isRecording: boolean;
  elapsedMs: number;
  error: string | null;
  previewingId: string | null;
  onStart: () => void;
  onStop: () => void;
  onPreview: (rec: Recording, effect?: VoiceEffect) => void;
  onStopPreview: () => void;
  onSetEffect: (id: string, effect: VoiceEffect) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export default function VoiceView({
  voiceTakes,
  isRecording,
  elapsedMs,
  error,
  previewingId,
  onStart,
  onStop,
  onPreview,
  onStopPreview,
  onSetEffect,
  onRename,
  onDelete,
}: Props) {
  return (
    <div className="voice-view">
      <section className="voice-record-panel" aria-label="Record voice">
        <button
          className={`voice-record-btn${isRecording ? " recording" : ""}`}
          onClick={isRecording ? onStop : onStart}
          aria-label={isRecording ? "Stop recording" : "Record voice"}
          aria-pressed={isRecording}
        >
          <span className="voice-record-dot" aria-hidden="true" />
          {isRecording ? "Stop" : "Record voice"}
        </button>
        {isRecording && (
          <span className="voice-elapsed" role="timer">
            {formatDuration(elapsedMs)}
          </span>
        )}
        <p className="voice-hint">
          Record your voice, add a funny effect, then drag it into a Song like any other brick.
        </p>
        {error && (
          <p className="voice-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="voice-list-panel" aria-label="Voice takes">
        <h2 className="library-title">Voice takes</h2>
        {voiceTakes.length === 0 ? (
          <p className="rec-empty">No voice takes yet — hit Record voice.</p>
        ) : (
          <ul className="voice-list">
            {voiceTakes.map((rec) => (
              <VoiceRow
                key={rec.id}
                rec={rec}
                isPlaying={previewingId === rec.id}
                onPreview={onPreview}
                onStopPreview={onStopPreview}
                onSetEffect={onSetEffect}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function VoiceRow({
  rec,
  isPlaying,
  onPreview,
  onStopPreview,
  onSetEffect,
  onRename,
  onDelete,
}: {
  rec: Recording;
  isPlaying: boolean;
  onPreview: (rec: Recording, effect?: VoiceEffect) => void;
  onStopPreview: () => void;
  onSetEffect: (id: string, effect: VoiceEffect) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rec.name);
  const effect = rec.audio?.effect ?? "none";

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== rec.name) onRename(rec.id, draft.trim());
    else setDraft(rec.name);
  };

  return (
    <li className="voice-row">
      <button
        className={`clip-card-play${isPlaying ? " playing" : ""}`}
        aria-label={isPlaying ? `Stop ${rec.name}` : `Play ${rec.name}`}
        title={isPlaying ? "Stop" : "Play"}
        onClick={() => (isPlaying ? onStopPreview() : onPreview(rec))}
      >
        {isPlaying ? "■" : "▶"}
      </button>

      {editing ? (
        <input
          className="voice-name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(rec.name);
              setEditing(false);
            }
          }}
          aria-label={`Rename ${rec.name}`}
        />
      ) : (
        <button className="voice-name" onClick={() => setEditing(true)} title="Click to rename">
          {rec.name}
        </button>
      )}

      <span className="voice-dur">{formatDuration(rec.durationMs)}</span>

      <select
        className="voice-effect-select"
        value={effect}
        aria-label={`Effect for ${rec.name}`}
        onChange={(e) => {
          const next = e.target.value as VoiceEffect;
          onSetEffect(rec.id, next);
          onPreview(rec, next); // hear it immediately
        }}
      >
        {VOICE_EFFECTS.map((eff) => (
          <option key={eff.value} value={eff.value}>
            {eff.label}
          </option>
        ))}
      </select>

      <button
        className="voice-delete"
        aria-label={`Delete ${rec.name}`}
        title="Delete"
        onClick={() => onDelete(rec.id)}
      >
        ×
      </button>
    </li>
  );
}
