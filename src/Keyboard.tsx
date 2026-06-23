import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// 25-key layout: C3 (note 48) up to C5 (note 72) — two octaves, the standard
// 25-key controller span (15 white + 10 black keys).
const FIRST_NOTE = 48; // C3
const KEY_COUNT = 25; // C3..C5 inclusive
const WHITE_WIDTH = 36; // px — keep in sync with .key.white width in App.css
const BLACK_WIDTH = 22; // px — keep in sync with .key.black width in App.css

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Pitch classes (note % 12) that are white keys.
const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

// Computer-keyboard mapping (one octave + top C), relative to the current octave
// base. White keys on the home row, black keys on the row above — the layout most
// soft synths use. Z/X shift the octave.
const KEY_TO_OFFSET: Record<string, number> = {
  a: 0, // C
  w: 1, // C#
  s: 2, // D
  e: 3, // D#
  d: 4, // E
  f: 5, // F
  t: 6, // F#
  g: 7, // G
  y: 8, // G#
  h: 9, // A
  u: 10, // A#
  j: 11, // B
  k: 12, // C (next octave)
};
const OCTAVE_DOWN_KEY = "z";
const OCTAVE_UP_KEY = "x";
const DEFAULT_OCTAVE_BASE = 60; // C4
const OCTAVE_BASE_MIN = 24; // C1
const OCTAVE_BASE_MAX = 96; // C7

type KeyDef = {
  note: number;
  name: string; // full name incl. octave, e.g. "C4" — accessible label
  label: string; // short visible label on white keys (octave only on C), "" on black
  isBlack: boolean;
  left: number; // absolute x offset in px within the keyboard
};

/** Build the key layout once: white keys tile left→right; black keys straddle
 *  the gap before the next white key. Pure — derived from the consts. */
function buildKeys(): { keys: KeyDef[]; whiteCount: number } {
  const keys: KeyDef[] = [];
  let whiteCount = 0;
  for (let i = 0; i < KEY_COUNT; i++) {
    const note = FIRST_NOTE + i;
    const cls = note % 12;
    const octave = Math.floor(note / 12) - 1; // MIDI: C4 = note 60
    const name = `${NOTE_NAMES[cls]}${octave}`;
    const isBlack = !WHITE_CLASSES.has(cls);
    if (isBlack) {
      keys.push({ note, name, label: "", isBlack, left: whiteCount * WHITE_WIDTH - BLACK_WIDTH / 2 });
    } else {
      keys.push({
        note,
        name,
        label: cls === 0 ? `C${octave}` : NOTE_NAMES[cls],
        isBlack,
        left: whiteCount * WHITE_WIDTH,
      });
      whiteCount += 1;
    }
  }
  return { keys, whiteCount };
}

const { keys: KEYS, whiteCount: WHITE_COUNT } = buildKeys();
const KEYBOARD_WIDTH = WHITE_COUNT * WHITE_WIDTH;

/**
 * On-screen + computer keyboard (STORY-K1/K2/K3 engine; 25-key surface, plus the
 * STORY-K5 computer-key mapping pulled forward so chords can be *held*).
 *
 * Each key sends `note_on` on press and `note_off` on release. A held-note set
 * makes press idempotent so pointer quirks (pointerup AND pointerleave) and OS
 * key auto-repeat cannot double-fire. Physical keys are tracked by key→note so a
 * note-off releases the exact pitch pressed even if the octave shifted meanwhile.
 */
function Keyboard() {
  const held = useRef<Set<number>>(new Set());
  const keyToNote = useRef<Map<string, number>>(new Map());
  const octaveBaseRef = useRef<number>(DEFAULT_OCTAVE_BASE);
  const [octaveBase, setOctaveBase] = useState<number>(DEFAULT_OCTAVE_BASE);
  // Notes currently held — drives the on-screen highlight (mouse or computer key).
  const [heldNotes, setHeldNotes] = useState<ReadonlySet<number>>(new Set());

  const press = useCallback((note: number) => {
    if (held.current.has(note)) return; // already sounding — ignore duplicate down
    held.current.add(note);
    setHeldNotes(new Set(held.current));
    invoke("note_on", { note }).catch((e) => console.error("note_on failed", e));
  }, []);

  const release = useCallback((note: number) => {
    if (!held.current.has(note)) return; // not currently held
    held.current.delete(note);
    setHeldNotes(new Set(held.current));
    invoke("note_off", { note }).catch((e) => console.error("note_off failed", e));
  }, []);

  const releaseAll = useCallback(() => {
    for (const note of held.current) {
      invoke("note_off", { note }).catch((e) => console.error("note_off failed", e));
    }
    held.current.clear();
    keyToNote.current.clear();
    setHeldNotes(new Set());
  }, []);

  // Computer-keyboard input (STORY-K5): map physical keys to notes, suppress OS
  // auto-repeat, and shift octaves with Z/X.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // OS auto-repeat must not retrigger the note
      const key = e.key.toLowerCase();
      if (key === OCTAVE_DOWN_KEY || key === OCTAVE_UP_KEY) {
        const delta = key === OCTAVE_DOWN_KEY ? -12 : 12;
        const next = Math.min(OCTAVE_BASE_MAX, Math.max(OCTAVE_BASE_MIN, octaveBaseRef.current + delta));
        octaveBaseRef.current = next;
        setOctaveBase(next);
        return;
      }
      const offset = KEY_TO_OFFSET[key];
      if (offset === undefined || keyToNote.current.has(key)) return;
      const note = octaveBaseRef.current + offset;
      keyToNote.current.set(key, note);
      press(note);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const note = keyToNote.current.get(key);
      if (note !== undefined) {
        keyToNote.current.delete(key);
        release(note);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [press, release]);

  // Release everything on pointer-up anywhere, window blur, or unmount.
  useEffect(() => {
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [releaseAll]);

  const handlers = (note: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press(note);
    },
    onPointerUp: () => release(note),
    onPointerLeave: () => release(note),
    onPointerCancel: () => release(note),
  });

  const octaveLabel = `C${Math.floor(octaveBase / 12) - 1}`;

  return (
    <>
      <div className="keyboard" style={{ width: KEYBOARD_WIDTH }}>
        {KEYS.map(({ note, name, label, isBlack, left }) => {
          const cls = `key ${isBlack ? "black" : "white"}${heldNotes.has(note) ? " held" : ""}`;
          return (
            <button
              key={note}
              type="button"
              className={cls}
              data-note={note}
              aria-label={`${name} (note ${note})`}
              style={{ left }}
              {...handlers(note)}
            >
              {label && <span className="key-label">{label}</span>}
            </button>
          );
        })}
      </div>
      <p className="kbd-hint">
        Computer keys: <kbd>A</kbd>–<kbd>K</kbd> white, <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd>{" "}
        <kbd>Y</kbd> <kbd>U</kbd> black · <kbd>Z</kbd>/<kbd>X</kbd> octave (now {octaveLabel}). Hold
        several to play chords.
      </p>
    </>
  );
}

export default Keyboard;
