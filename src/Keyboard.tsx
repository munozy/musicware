import { useCallback, useEffect, useRef } from "react";
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

type KeyDef = {
  note: number;
  /** full name incl. octave, e.g. "C4" — used for the accessible label */
  name: string;
  /** short visible label on white keys (octave only on C), "" on black keys */
  label: string;
  isBlack: boolean;
  /** absolute x offset in px within the keyboard */
  left: number;
};

/** Build the key layout once: white keys tile left→right; black keys straddle
 *  the gap before the next white key. Pure — derived entirely from the consts. */
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
      keys.push({
        note,
        name,
        label: "",
        isBlack,
        left: whiteCount * WHITE_WIDTH - BLACK_WIDTH / 2,
      });
    } else {
      keys.push({
        note,
        name,
        label: cls === 0 ? `C${octave}` : NOTE_NAMES[cls], // octave marker on every C
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
 * On-screen keyboard (STORY-K1/K2; 25-key 2-octave surface).
 *
 * Each key sends a `note_on` Tauri command on press and a `note_off` on release.
 * A held-note set makes press idempotent so OS/pointer quirks (e.g. pointerup
 * AND pointerleave both firing, or auto-repeat) cannot double-fire an event.
 * Computer-key mapping, key-repeat suppression and octave shift are STORY-K5.
 */
function Keyboard() {
  const held = useRef<Set<number>>(new Set());

  const press = useCallback((note: number) => {
    if (held.current.has(note)) return; // already sounding — ignore duplicate down
    held.current.add(note);
    invoke("note_on", { note }).catch((e) => console.error("note_on failed", e));
  }, []);

  const release = useCallback((note: number) => {
    if (!held.current.has(note)) return; // not currently held
    held.current.delete(note);
    invoke("note_off", { note }).catch((e) => console.error("note_off failed", e));
  }, []);

  // Release every held note when the pointer is released anywhere, when the
  // window loses focus, or on unmount — so holding a key and alt/cmd-tabbing
  // away never strands a note that sounds forever.
  useEffect(() => {
    const releaseAll = () => {
      for (const note of held.current) {
        invoke("note_off", { note }).catch((e) =>
          console.error("note_off failed", e),
        );
      }
      held.current.clear();
    };
    window.addEventListener("pointerup", releaseAll);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseAll);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, []);

  const handlers = (note: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press(note);
    },
    onPointerUp: () => release(note),
    onPointerLeave: () => release(note),
    onPointerCancel: () => release(note),
  });

  return (
    <div className="keyboard" style={{ width: KEYBOARD_WIDTH }}>
      {KEYS.map(({ note, name, label, isBlack, left }) => (
        <button
          key={note}
          type="button"
          className={isBlack ? "key black" : "key white"}
          data-note={note}
          aria-label={`${name} (note ${note})`}
          style={{ left }}
          {...handlers(note)}
        >
          {label && <span className="key-label">{label}</span>}
        </button>
      ))}
    </div>
  );
}

export default Keyboard;
