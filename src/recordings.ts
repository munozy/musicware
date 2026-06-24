import type { SynthEvent } from "./synth";

/** A captured event, timestamped in ms from the start of the take. */
export type RecEvent = SynthEvent & { t: number };

export type Recording = {
  id: string;
  name: string;
  createdAt: number; // epoch ms
  durationMs: number;
  events: RecEvent[];
};

const STORAGE_KEY = "musicware.recordings.v1";

/** Load the saved library. Tolerates missing/corrupt storage by returning []. */
export function loadRecordings(): Recording[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Recording[]) : [];
  } catch {
    return [];
  }
}

/** Persist the whole library (the source of truth is always the in-memory list). */
export function saveRecordings(list: Recording[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("failed to persist recordings", e);
  }
}

/** Collision-resistant id without needing crypto in every test runtime. */
export function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/**
 * Next default name: "Composition N" where N is one past the highest existing
 * "Composition <number>" — so it stays unique even after middle items are deleted.
 */
export function nextName(list: Recording[]): string {
  let max = 0;
  for (const r of list) {
    const m = /^Composition (\d+)$/.exec(r.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Composition ${max + 1}`;
}

/** mm:ss for the UI. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
