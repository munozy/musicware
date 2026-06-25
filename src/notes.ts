// Shared note helpers — one source of truth for pitch math and names.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Equal-tempered frequency for a note number (A4 = 69 = 440 Hz). */
export function noteToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Pitch class 0..11 (C..B), wrap-safe. */
export function pitchClass(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Full name incl. octave, e.g. note 60 → "C4". */
export function noteLabel(n: number): string {
  return `${NOTE_NAMES[pitchClass(n)]}${Math.floor(n / 12) - 1}`;
}

// Drum-kit names by pitch class — must match `drum_params` in src-tauri/src/audio.rs
// (the Drums preset maps note % 12 → a drum). Used to label the UI in Drums mode
// so a "kick" reads as Kick, not "C".
export const DRUM_NAMES = [
  "Kick", "Rim", "Snare", "Clap", "Tom", "Tom", "Closed hat", "Tom", "Open hat", "Crash", "Cowbell", "Ride",
];

export function drumName(n: number): string {
  return DRUM_NAMES[pitchClass(n)];
}
