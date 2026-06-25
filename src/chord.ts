import { NOTE_NAMES, pitchClass } from "./notes";

// Chord intelligence: name the harmony from the set of sounding notes.
// `analyzeChord` returns a structured result (root + quality) so the UI can show
// "C major" rather than a bare "C" that looks like a single note; `detectChord`
// is the flat-symbol convenience used in tests and compact contexts.

// sym = standard symbol suffix (for the chord symbol); label = friendly quality
// word (for the big display); pcs = intervals from root, mod 12, sorted.
type Shape = { sym: string; label: string; pcs: number[] };

// Ordered by priority: richer/4-note shapes first, then triads, then the dyad.
const SHAPES: Shape[] = [
  { sym: "maj7", label: "maj7", pcs: [0, 4, 7, 11] },
  { sym: "7", label: "7", pcs: [0, 4, 7, 10] },
  { sym: "m7", label: "min7", pcs: [0, 3, 7, 10] },
  { sym: "m7♭5", label: "min7♭5", pcs: [0, 3, 6, 10] },
  { sym: "dim7", label: "dim7", pcs: [0, 3, 6, 9] },
  { sym: "6", label: "6", pcs: [0, 4, 7, 9] },
  { sym: "m6", label: "min6", pcs: [0, 3, 7, 9] },
  { sym: "add9", label: "add9", pcs: [0, 2, 4, 7] },
  { sym: "maj", label: "major", pcs: [0, 4, 7] },
  { sym: "m", label: "minor", pcs: [0, 3, 7] },
  { sym: "dim", label: "dim", pcs: [0, 3, 6] },
  { sym: "aug", label: "aug", pcs: [0, 4, 8] },
  { sym: "sus4", label: "sus4", pcs: [0, 5, 7] },
  { sym: "sus2", label: "sus2", pcs: [0, 2, 7] },
  { sym: "5", label: "power", pcs: [0, 7] },
];

const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function uniquePitchClasses(notes: number[]): number[] {
  return [...new Set(notes.map(pitchClass))].sort((a, b) => a - b);
}

export type ChordAnalysis =
  | { kind: "empty" }
  | { kind: "single"; root: string }
  | { kind: "chord"; root: string; quality: string; sym: string; bass: string | null }
  | { kind: "cluster"; names: string[] };

/**
 * Structured analysis of the sounding notes. Tries the bass note as root first so
 * an ambiguous set (C-D-G = Csus2 vs Gsus4) is named relative to the bass.
 */
export function analyzeChord(notes: number[]): ChordAnalysis {
  const pcs = uniquePitchClasses(notes);
  if (pcs.length === 0) return { kind: "empty" };
  if (pcs.length === 1) return { kind: "single", root: NOTE_NAMES[pcs[0]] };

  const bassPc = pitchClass(Math.min(...notes));
  const roots = [bassPc, ...pcs.filter((pc) => pc !== bassPc)];

  for (const root of roots) {
    const rel = pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const shape of SHAPES) {
      if (shape.pcs.length === pcs.length && eq(rel, shape.pcs)) {
        return {
          kind: "chord",
          root: NOTE_NAMES[root],
          quality: shape.label,
          sym: shape.sym,
          bass: bassPc === root ? null : NOTE_NAMES[bassPc],
        };
      }
    }
  }
  // Not a recognised chord — list the distinct notes in PITCH order (low→high),
  // matching the note line, rather than chromatic-from-C pitch-class order.
  const ordered = [...new Set([...notes].sort((a, b) => a - b).map(pitchClass))];
  return { kind: "cluster", names: ordered.map((pc) => NOTE_NAMES[pc]) };
}

/** Flat chord symbol, e.g. "Cmaj7", "Am", "C/E", or note names for a cluster. */
export function detectChord(notes: number[]): string {
  const a = analyzeChord(notes);
  switch (a.kind) {
    case "empty":
      return "";
    case "single":
      return a.root;
    case "chord":
      return a.root + (a.sym === "maj" ? "" : a.sym) + (a.bass ? `/${a.bass}` : "");
    case "cluster":
      return a.names.join(" ");
  }
}
