import { useEffect, useState } from "react";
import { analyzeChord } from "./chord";
import { drumName, noteLabel } from "./notes";
import { getCurrentPreset, subscribePreset } from "./synth";
import { useActiveNotes } from "./useActiveNotes";

// Must match PRESETS in src-tauri/src/audio.rs (the Drums kit is preset index 4).
const DRUMS_PRESET = 4;

/**
 * Real-time read-out of what you're holding (live or in replay). For tonal presets
 * it names the harmony — root big, quality beside it ("C" + "major", "Cm7", "C/E"),
 * a single note shows its octave. For the DRUMS preset it shows the DRUM names
 * (Kick · Snare …) instead of pitches, so the kit doesn't lie about notes (DEBT-023).
 * A debounced, visually-hidden live region announces only the settled label to AT.
 */
function ChordDisplay() {
  const active = useActiveNotes();
  const [preset, setPreset] = useState(getCurrentPreset);
  useEffect(() => subscribePreset(setPreset), []);

  const notes = [...active].sort((a, b) => a - b);
  const isDrums = preset === DRUMS_PRESET;
  const on = notes.length > 0;

  let primary = "—";
  let quality: string | null = null;
  let cluster = false;
  let noteLine = "play to detect";

  if (isDrums) {
    const names = [...new Set(notes.map(drumName))]; // pitch-ordered, de-duped
    primary = names.join(" · ") || "—";
    cluster = true; // drum names are long → smaller font
    noteLine = on ? "drum kit" : "play to detect";
  } else {
    const a = analyzeChord(notes);
    noteLine = notes.map(noteLabel).join("  ·  ") || "play to detect";
    if (a.kind === "single") primary = noteLabel(notes[0]); // octave → not a chord root
    else if (a.kind === "chord") {
      primary = a.bass ? `${a.root}/${a.bass}` : a.root;
      quality = a.quality;
    } else if (a.kind === "cluster") {
      primary = a.names.join(" ");
      cluster = true;
    }
  }

  // Settle the announcement so a held chord/roll isn't read out hit-by-hit.
  const label = on ? `${primary}${quality ? ` ${quality}` : ""}` : "";
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(label), 200);
    return () => clearTimeout(id);
  }, [label]);

  return (
    <div className="chord" aria-label={isDrums ? "Drums" : "Chord and notes"}>
      <div className="chord-line">
        <span className={`chord-symbol${on ? " on" : ""}${cluster ? " cluster" : ""}`}>{primary}</span>
        {quality && <span className="chord-quality">{quality}</span>}
      </div>
      <div className="chord-notes">{noteLine}</div>
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
    </div>
  );
}

export default ChordDisplay;
