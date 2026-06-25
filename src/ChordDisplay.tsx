import { analyzeChord } from "./chord";
import { noteLabel } from "./notes";
import { useActiveNotes } from "./useActiveNotes";

/**
 * Real-time chord & note read-out. Names the harmony you're holding (live or in
 * replay): root big, quality beside it ("C" + "major", "C" + "min7", "C/E"), with
 * the individual notes underneath. A bare single letter means a single note.
 */
function ChordDisplay() {
  const active = useActiveNotes();
  const notes = [...active].sort((a, b) => a - b);
  const a = analyzeChord(notes);
  const noteLine = notes.map(noteLabel).join("  ·  ") || "play to detect";

  let primary = "—";
  let quality: string | null = null;
  let cluster = false;
  if (a.kind === "single") primary = a.root;
  else if (a.kind === "chord") {
    primary = a.bass ? `${a.root}/${a.bass}` : a.root;
    quality = a.quality;
  } else if (a.kind === "cluster") {
    primary = a.names.join(" ");
    cluster = true;
  }

  return (
    <div className="chord" role="status" aria-live="polite" aria-label="Chord and notes">
      <div className="chord-line">
        <span className={`chord-symbol${a.kind !== "empty" ? " on" : ""}${cluster ? " cluster" : ""}`}>
          {primary}
        </span>
        {quality && <span className="chord-quality">{quality}</span>}
      </div>
      <div className="chord-notes">{noteLine}</div>
    </div>
  );
}

export default ChordDisplay;
