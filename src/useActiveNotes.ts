import { useEffect, useRef, useState } from "react";
import { subscribeNotes } from "./synth";

/**
 * The set of notes currently sounding — sourced from the synth note broadcast, so
 * it reflects BOTH live play and recording replay. A per-note refcount keeps it
 * correct when a note is held live while replay also plays it. Shared by the
 * keyboard highlight, the visualizer, and the chord display (one source of truth).
 */
export function useActiveNotes(): ReadonlySet<number> {
  const counts = useRef<Map<number, number>>(new Map());
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());

  useEffect(
    () =>
      subscribeNotes(({ kind, note }) => {
        const c = counts.current;
        const next = (c.get(note) ?? 0) + (kind === "on" ? 1 : -1);
        if (next > 0) c.set(note, next);
        else c.delete(note);
        setActive(new Set(c.keys()));
      }),
    [],
  );

  return active;
}
