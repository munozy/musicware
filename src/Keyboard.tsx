import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type Key = { note: number; label: string };

// One octave: C4 (note 60) .. B4 (note 71). Pitch = 440 * 2^((n-69)/12) in the engine.
const WHITE_KEYS: Key[] = [
  { note: 60, label: "C" },
  { note: 62, label: "D" },
  { note: 64, label: "E" },
  { note: 65, label: "F" },
  { note: 67, label: "G" },
  { note: 69, label: "A" },
  { note: 71, label: "B" },
];

// Black keys sit over the gap after the white key at index `afterWhite`.
const BLACK_KEYS: (Key & { afterWhite: number })[] = [
  { note: 61, label: "C#", afterWhite: 0 },
  { note: 63, label: "D#", afterWhite: 1 },
  { note: 66, label: "F#", afterWhite: 3 },
  { note: 68, label: "G#", afterWhite: 4 },
  { note: 70, label: "A#", afterWhite: 5 },
];

const WHITE_WIDTH = 48; // px — keep in sync with .key.white width in App.css
const BLACK_WIDTH = 30;

/**
 * A minimal one-octave on-screen keyboard (STORY-K1).
 *
 * Each key sends a `note_on` Tauri command on press and a `note_off` on release.
 * A held-note set makes press idempotent so OS/pointer quirks (e.g. pointerup
 * AND pointerleave both firing, or auto-repeat) cannot double-fire an event.
 * Computer-key mapping, key-repeat suppression and multi-octave are STORY-K5.
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
  // window loses focus, or on unmount.  Without this, holding a key and then
  // alt/cmd-tabbing away never fires pointerup/leave on the button, stranding
  // a note that sounds forever.
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
      releaseAll(); // unmount: don't leave anything sounding
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
    <div className="keyboard">
      {WHITE_KEYS.map(({ note, label }) => (
        <button
          key={note}
          type="button"
          className="key white"
          data-note={note}
          aria-label={`${label} (note ${note})`}
          {...handlers(note)}
        >
          <span className="key-label">{label}</span>
        </button>
      ))}
      {BLACK_KEYS.map(({ note, label, afterWhite }) => (
        <button
          key={note}
          type="button"
          className="key black"
          data-note={note}
          aria-label={`${label} (note ${note})`}
          style={{ left: (afterWhite + 1) * WHITE_WIDTH - BLACK_WIDTH / 2 }}
          {...handlers(note)}
        >
          <span className="key-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

export default Keyboard;
