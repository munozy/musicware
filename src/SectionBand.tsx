/**
 * SectionBand — the song-structure strip above the timeline lanes (Slice 6, US-20/21).
 * Labeled regions (Intro / Verse / Chorus …) you can add, rename, drag to move, drag the right
 * edge to resize, and delete — plus one-click genre templates (the "blank-canvas cure"). Aligned
 * to the lane x-origin + PX_PER_MS scale so a section lines up with the clips beneath it.
 * Sections are a VISUAL guide only; they never affect playback (flattenArrangement ignores them).
 */

import { useRef, useState } from "react";
import type { Section } from "./arrangement";
import { SECTION_TEMPLATES } from "./arrangementStore";
import { msToPx, pxToMs, snapMs, PX_PER_MS, LANE_ORIGIN_PX } from "./timeScale";

const SNAP_MS = 100;
const NEW_SECTION_MS = 4000;
const DEFAULT_SPAN_MS = 30_000; // template span when the song is still empty

export type SectionOps = {
  onAddSection: (startMs: number, endMs: number) => void;
  onRenameSection: (id: string, name: string) => void;
  onMoveSection: (id: string, startMs: number) => void;
  onResizeSection: (id: string, endMs: number) => void;
  onRemoveSection: (id: string) => void;
  onApplyTemplate: (key: string, totalMs: number) => void;
  onSuggestSection: (section: Section) => void;
};

type Props = {
  sections: Section[];
  contentMs: number; // the arrangement's content length, to size new sections / templates
  ops: SectionOps;
};

function SectionBlock({ section, ops }: { section: Section; ops: SectionOps }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  // Focus returns to the block after a KEYBOARD-ended rename (Enter/Escape) so the keyboard
  // move/resize path isn't stranded on <body>; a mouse blur (clicking elsewhere) must NOT
  // steal focus back. finishedRef guards reentrancy: Enter commits, then refocusing the block
  // blurs the still-mounted input, and without the guard that blur would commit AGAIN.
  const blockRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);

  const left = msToPx(section.startMs, PX_PER_MS);
  const width = Math.max(10, msToPx(section.endMs - section.startMs, PX_PER_MS));

  // Drag the body to move (preserve length); drag the right handle to resize the end.
  const beginDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = section.startMs;
    const origEnd = section.endMs;
    const onMove = (ev: PointerEvent) => {
      const deltaMs = pxToMs(ev.clientX - startX, PX_PER_MS);
      if (mode === "move") ops.onMoveSection(section.id, snapMs(origStart + deltaMs, SNAP_MS));
      else ops.onResizeSection(section.id, snapMs(origEnd + deltaMs, SNAP_MS));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** End the rename exactly once. commit=false reverts; restoreFocus only for keyboard exits. */
  const finish = (commit: boolean, restoreFocus: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setEditing(false);
    if (commit && draft.trim() && draft.trim() !== section.name) ops.onRenameSection(section.id, draft.trim());
    else setDraft(section.name);
    if (restoreFocus) blockRef.current?.focus();
  };

  // Keyboard path for move/resize (DEBT-034 — drag had no non-pointer fallback): arrows nudge
  // the whole section, Shift+arrows resize the end. Keys from the inner rename input / buttons
  // are ignored (target !== currentTarget) so typing a name never moves the section.
  const KB_STEP_MS = 500;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // don't hijack modified chords (Cmd+Arrow etc.)
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    if (e.shiftKey) ops.onResizeSection(section.id, section.endMs + dir * KB_STEP_MS); // store clamps
    else ops.onMoveSection(section.id, Math.max(0, section.startMs + dir * KB_STEP_MS));
  };

  return (
    <div
      ref={blockRef}
      className="section-block"
      style={{ left, width, background: section.color }}
      onPointerDown={beginDrag("move")}
      tabIndex={0}
      role="group"
      aria-label={`${section.name} section, ${(section.startMs / 1000).toFixed(1)} to ${(section.endMs / 1000).toFixed(1)} seconds. Arrow keys move; Shift plus arrows resize.`}
      onKeyDown={handleKeyDown}
      title={`${section.name} — drag to move, drag the right edge to resize · arrows/Shift+arrows when focused`}
    >
      {editing ? (
        <input
          className="section-name-input"
          value={draft}
          autoFocus
          aria-label={`Rename ${section.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true, false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(true, true);
            else if (e.key === "Escape") finish(false, true);
          }}
        />
      ) : (
        <button
          className="section-name"
          aria-label={`Section ${section.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setDraft(section.name);
            finishedRef.current = false; // a fresh edit can finish again
            setEditing(true);
          }}
        >
          {section.name}
        </button>
      )}
      <button
        className="section-suggest"
        aria-label={`Suggest clips for ${section.name}`}
        title="Suggest what fits here"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ops.onSuggestSection(section);
        }}
      >
        ✨
      </button>
      <button
        className="section-del"
        aria-label={`Remove section ${section.name}`}
        title="Remove section"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ops.onRemoveSection(section.id);
        }}
      >
        ×
      </button>
      <span className="section-resize" aria-hidden="true" onPointerDown={beginDrag("resize")} />
    </div>
  );
}

export default function SectionBand({ sections, contentMs, ops }: Props) {
  const span = contentMs > 0 ? contentMs : DEFAULT_SPAN_MS;

  const addAtEnd = () => {
    const start = sections.reduce((m, s) => Math.max(m, s.endMs), 0);
    ops.onAddSection(start, start + NEW_SECTION_MS);
  };

  return (
    <div className="section-band-wrap">
      <div className="section-band-toolbar">
        <span className="section-band-label">Structure</span>
        <button className="track-btn" onClick={addAtEnd} aria-label="Add section">
          + Section
        </button>
        <select
          className="section-template-select"
          value=""
          aria-label="Apply structure template"
          onChange={(e) => {
            if (e.target.value) ops.onApplyTemplate(e.target.value, span);
            e.target.value = "";
          }}
        >
          <option value="">Template…</option>
          {Object.entries(SECTION_TEMPLATES).map(([key, t]) => (
            <option key={key} value={key}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="section-band" style={{ marginLeft: LANE_ORIGIN_PX }}>
        {sections.length === 0 ? (
          <span className="section-band-empty">No structure yet — add sections or pick a template.</span>
        ) : (
          sections.map((s) => <SectionBlock key={s.id} section={s} ops={ops} />)
        )}
      </div>
    </div>
  );
}
