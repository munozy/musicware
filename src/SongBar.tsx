/**
 * SongBar — the song-library CRUD strip at the top of the Song view: pick a song, create a
 * new one, rename the active one, delete (with a confirm). Presentational; state comes from
 * App's useArrangement song library.
 */

import { useEffect, useRef, useState } from "react";

type SongRef = { id: string; name: string };
type ExportFormat = "mp3" | "wav";

type Props = {
  songs: SongRef[];
  activeSongId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (format: ExportFormat) => void;
  exporting: boolean;
};

export default function SongBar({ songs, activeSongId, onSelect, onNew, onRename, onDelete, onExport, exporting }: Props) {
  const active = songs.find((s) => s.id === activeSongId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(active?.name ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("mp3");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset transient UI when the active song changes out from under us.
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setDraft(active?.name ?? "");
  }, [activeSongId, active?.name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== active?.name) onRename(activeSongId, draft.trim());
    else setDraft(active?.name ?? "");
  };

  return (
    <div className="song-bar" role="group" aria-label="Song library">
      <span className="song-bar-label">Song</span>

      {editing ? (
        <input
          ref={inputRef}
          className="song-bar-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(active?.name ?? "");
              setEditing(false);
            }
          }}
          aria-label="Song name"
        />
      ) : (
        <select
          className="song-bar-select"
          value={activeSongId}
          aria-label="Select song"
          onChange={(e) => onSelect(e.target.value)}
        >
          {songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <button className="song-bar-btn" onClick={onNew} aria-label="New song" title="New song">
        ＋ New
      </button>
      <button
        className="song-bar-btn"
        onClick={() => (editing ? commit() : setEditing(true))}
        aria-label={editing ? "Save song name" : "Rename song"}
        title="Rename"
      >
        ✎
      </button>

      {confirmDelete ? (
        <span className="song-bar-confirm">
          <span>Delete?</span>
          <button
            className="song-bar-btn danger"
            onClick={() => {
              onDelete(activeSongId);
              setConfirmDelete(false);
            }}
            aria-label="Confirm delete song"
          >
            Yes
          </button>
          <button className="song-bar-btn" onClick={() => setConfirmDelete(false)} aria-label="Cancel delete">
            No
          </button>
        </span>
      ) : (
        <button
          className="song-bar-btn"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete song"
          title="Delete song"
          disabled={songs.length <= 1}
        >
          🗑
        </button>
      )}

      <span className="song-bar-export-group">
        <select
          className="song-bar-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          disabled={exporting}
          aria-label="Export format"
          title="Export format"
        >
          <option value="mp3">MP3</option>
          <option value="wav">WAV</option>
        </select>
        <button
          className="song-bar-btn song-bar-export"
          onClick={() => onExport(format)}
          disabled={exporting}
          aria-label="Export song"
          title={`Export as ${format.toUpperCase()}`}
        >
          {exporting ? "Exporting…" : "⬇ Export"}
        </button>
      </span>
    </div>
  );
}
