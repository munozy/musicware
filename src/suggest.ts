/**
 * "Suggest what fits" — the AI-assist STUB (Slice 9, US-26). Pure heuristic, no model: given a
 * section's duration, rank the user's recordings by how well each one fills it when looped, so a
 * beginner staring at an empty section gets concrete one-click candidates. Deliberately simple
 * and transparent (it's a hook for a smarter future suggester, not the suggester itself).
 */

import { isVoice, effectiveVoiceDurationMs, type Recording } from "./recordings";

/** The length a take actually SOUNDS when placed: rate-shifted for voice takes (DEBT-034 r3). */
function soundMsOf(r: Recording): number {
  return isVoice(r) && r.audio ? effectiveVoiceDurationMs(r.durationMs, r.audio.effect) : r.durationMs;
}

export type Suggestion = {
  recording: Recording;
  loopCount: number; // how many times to repeat it to fill the section
  fillMs: number; // loopCount × duration
  score: number; // 0..1, 1 = fills the section exactly
  reason: string;
};

/**
 * Rank recordings by duration-fit for a section of `sectionMs`. Each candidate is looped the
 * whole number of times that best fills the span; the score rewards a tight fit. Ties prefer
 * fewer loops, then the shorter take. Zero-length takes are skipped; empty input → [].
 */
export function suggestForSection(sectionMs: number, recordings: Recording[], max = 4): Suggestion[] {
  const span = Math.max(1, sectionMs);
  return recordings
    .filter((r) => soundMsOf(r) > 0)
    .map((r) => {
      const dur = soundMsOf(r); // audible length — a chipmunk take fills less than it recorded
      const loopCount = Math.max(1, Math.round(span / dur));
      const fillMs = loopCount * dur;
      const leftover = Math.abs(span - fillMs);
      const score = Math.max(0, 1 - leftover / span);
      const reason =
        loopCount === 1
          ? fillMs >= span * 0.9
            ? "fits the section"
            : "a bit shorter than the section"
          : `loops ${loopCount}× to fill`;
      return { recording: r, loopCount, fillMs, score, reason };
    })
    .sort((a, b) => b.score - a.score || a.loopCount - b.loopCount || soundMsOf(a.recording) - soundMsOf(b.recording))
    .slice(0, Math.max(0, max));
}
