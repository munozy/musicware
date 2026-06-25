import { useEffect, useState } from "react";
import { analyzeChord } from "./chord";
import { noteLabel } from "./notes";
import { useActiveNotes } from "./useActiveNotes";

/**
 * Real-time chord & note read-out. Names the harmony you're holding (live or in
 * replay): root big, quality beside it ("C" + "major", "Cm7", "C/E"), with the
 * note line underneath. A single note shows its octave (e.g. "C4") so it can't be
 * confused with a chord root. The visuals update every note; a debounced,
 * visually-hidden live region announces only the settled name to screen readers.
 */
function ChordDisplay() {
  const active = useActiveNotes();
  const notes = [...active].sort((a, b) => a - b);
  const a = analyzeChord(notes);
  const noteLine = notes.map(noteLabel).join("  ·  ") || "play to detect";

  let primary = "—";
  let quality: string | null = null;
  let cluster = false;
  if (a.kind === "single") primary = noteLabel(notes[0]); // octave → not a chord root
  else if (a.kind === "chord") {
    primary = a.bass ? `${a.root}/${a.bass}` : a.root;
    quality = a.quality;
  } else if (a.kind === "cluster") {
    primary = a.names.join(" ");
    cluster = true;
  }

  // Settle the announcement so a 6-event chord isn't read out note-by-note.
  const label = a.kind === "empty" ? "" : `${primary}${quality ? ` ${quality}` : ""}`;
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(label), 200);
    return () => clearTimeout(id);
  }, [label]);

  return (
    <div className="chord" aria-label="Chord and notes">
      <div className="chord-line">
        <span className={`chord-symbol${a.kind !== "empty" ? " on" : ""}${cluster ? " cluster" : ""}`}>
          {primary}
        </span>
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
