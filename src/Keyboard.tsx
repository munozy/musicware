import { useCallback, useEffect, useRef, useState } from "react";
import { noteOn, noteOff } from "./synth";
import { NOTE_NAMES } from "./notes";
import { useActiveNotes } from "./useActiveNotes";

// 61-key layout: C1 (note 24) up to C6 (note 84) — five octaves (36 white + 25 black).
const FIRST_NOTE = 24; // C1
const KEY_COUNT = 61; // C1..C6 inclusive
const WHITE_WIDTH = 34; // px — keep in sync with .key.white width in App.css
const BLACK_WIDTH = 20; // px — keep in sync with .key.black width in App.css

// Pitch classes (note % 12) that are white keys.
const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

// Computer-keyboard mapping (one octave + top C), relative to the current octave
// base. White keys on the home row, black keys on the row above. Z/X shift octaves.
const KEY_TO_OFFSET: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};
// Reverse map for showing the computer-key hint on each key.
const OFFSET_TO_KEY: Record<number, string> = Object.fromEntries(
  Object.entries(KEY_TO_OFFSET).map(([k, o]) => [o, k.toUpperCase()]),
);
const OCTAVE_DOWN_KEY = "z";
const OCTAVE_UP_KEY = "x";
const DEFAULT_OCTAVE_BASE = 48; // C3
const OCTAVE_BASE_MIN = 24; // C1
const OCTAVE_BASE_MAX = 72; // C5

type KeyDef = {
  note: number;
  name: string; // full name incl. octave — accessible label
  letter: string; // pitch-class letter, e.g. "C"
  label: string; // visible label on white keys (octave only on C)
  isBlack: boolean;
  left: number;
};

function buildKeys(): { keys: KeyDef[]; whiteCount: number } {
  const keys: KeyDef[] = [];
  let whiteCount = 0;
  for (let i = 0; i < KEY_COUNT; i++) {
    const note = FIRST_NOTE + i;
    const cls = note % 12;
    const octave = Math.floor(note / 12) - 1;
    const letter = NOTE_NAMES[cls];
    const name = `${letter}${octave}`;
    const isBlack = !WHITE_CLASSES.has(cls);
    if (isBlack) {
      keys.push({ note, name, letter, label: "", isBlack, left: whiteCount * WHITE_WIDTH - BLACK_WIDTH / 2 });
    } else {
      keys.push({
        note,
        name,
        letter,
        label: cls === 0 ? `C${octave}` : letter,
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
 * On-screen + computer keyboard. Each key sends note_on/note_off via the synth
 * dispatch path. The highlight is sourced from the shared active-notes hook, so it
 * lights up for live play AND recording replay. Keys in the current computer-key
 * octave show their QWERTY hint.
 */
function Keyboard() {
  const held = useRef<Set<number>>(new Set());
  const keyToNote = useRef<Map<string, number>>(new Map());
  const octaveBaseRef = useRef<number>(DEFAULT_OCTAVE_BASE);
  const [octaveBase, setOctaveBase] = useState<number>(DEFAULT_OCTAVE_BASE);
  const soundingNotes = useActiveNotes();

  const press = useCallback((note: number) => {
    if (held.current.has(note)) return;
    held.current.add(note);
    noteOn(note);
  }, []);

  const release = useCallback((note: number) => {
    if (!held.current.has(note)) return;
    held.current.delete(note);
    noteOff(note);
  }, []);

  const releaseAll = useCallback(() => {
    for (const note of held.current) noteOff(note);
    held.current.clear();
    keyToNote.current.clear();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
    <div className="keyboard-wrap">
      <div className="keyboard-scroll">
        <div className="keyboard" style={{ width: KEYBOARD_WIDTH }}>
          {KEYS.map(({ note, name, letter, label, isBlack, left }) => {
            const mapped = note >= octaveBase && note <= octaveBase + 12;
            const hint = mapped ? OFFSET_TO_KEY[note - octaveBase] : undefined;
            const cls =
              `key ${isBlack ? "black" : "white"}` +
              `${soundingNotes.has(note) ? " held" : ""}${mapped ? " mapped" : ""}`;
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
                {hint && <span className="key-hint">{hint}</span>}
                {!isBlack && (
                  <span className="key-label">{label}</span>
                )}
                {isBlack && <span className="key-note-b" aria-hidden="true">{letter}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="kbd-hint">
        Computer keys <kbd>A</kbd>–<kbd>K</kbd> (white) · <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd>{" "}
        <kbd>Y</kbd> <kbd>U</kbd> (black) · <kbd>Z</kbd>/<kbd>X</kbd> octave — now{" "}
        <strong>{octaveLabel}</strong>. Hold several for chords.
      </p>
    </div>
  );
}

export default Keyboard;
