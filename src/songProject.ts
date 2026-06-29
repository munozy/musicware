/**
 * Song-project export/import — a portable, self-contained snapshot of ONE song plus every
 * recording it needs, so it can be re-imported and reconstructed exactly (even on another
 * machine or after the library changed). Distinct from the audio export (WAV/MP3): this is
 * the editable PROJECT.
 *
 * Bundle = the Arrangement + the referenced Recordings. Keyboard takes carry their symbolic
 * events (already JSON); voice takes carry their audio as base64 (the blob lives in
 * IndexedDB). On import every id is REMAPPED (song/track/clip/recording + blob keys) and
 * clip→recording references are rewired, so an import is always a clean additive restore —
 * it never collides with or overwrites existing songs/recordings.
 */

import { newId, isVoice, type Recording } from "./recordings";
import { newBlobKey, getBlob, putBlob } from "./voiceStore";
import type { Arrangement } from "./arrangement";

export const PROJECT_FORMAT = "musicware.songproject";
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = "mwsong";

/** A Recording in a bundle; voice takes carry their audio inline as base64. */
export type ExportedRecording = Recording & { audioBase64?: string };

export type ProjectBundle = {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: number;
  song: Arrangement;
  recordings: ExportedRecording[];
};

/** The recording ids referenced by any clip in the song. */
export function collectReferencedRecordingIds(song: Arrangement): Set<string> {
  const ids = new Set<string>();
  for (const t of song.tracks) for (const c of t.clips) ids.add(c.recordingId);
  return ids;
}

// ---- base64 <-> bytes (binary-safe, chunked to avoid call-stack blowups) ----

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---- export ----

/** Build a bundle for `song`, embedding the recordings it references (voice audio as base64). */
export async function buildProjectBundle(song: Arrangement, allRecordings: Recording[]): Promise<ProjectBundle> {
  const refs = collectReferencedRecordingIds(song);
  const recordings: ExportedRecording[] = [];
  for (const r of allRecordings) {
    if (!refs.has(r.id)) continue;
    if (isVoice(r) && r.audio) {
      const blob = await getBlob(r.audio.blobKey);
      const audioBase64 = blob ? bytesToBase64(new Uint8Array(await blob.arrayBuffer())) : undefined;
      recordings.push({ ...r, audioBase64 });
    } else {
      recordings.push({ ...r });
    }
  }
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, exportedAt: Date.now(), song, recordings };
}

export function serializeProject(bundle: ProjectBundle): string {
  return JSON.stringify(bundle);
}

// ---- import ----

/** Parse + validate a project file's text. Throws a friendly Error on anything malformed. */
export function parseProjectBundle(text: string): ProjectBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = parsed as Partial<ProjectBundle> | null;
  if (!b || typeof b !== "object" || b.format !== PROJECT_FORMAT) {
    throw new Error("That isn't a musicware song-project file.");
  }
  if (b.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version (${String(b.version)}). This app reads version ${PROJECT_VERSION}.`);
  }
  if (!b.song || !Array.isArray(b.song.tracks) || !Array.isArray(b.recordings)) {
    throw new Error("The project file is missing its song or recordings.");
  }
  return b as ProjectBundle;
}

/**
 * PURE remap of a bundle into fresh, collision-free state: new ids for the song, its tracks
 * and clips, and every recording; clip→recording references rewired; voice recordings get a
 * fresh blob key. Returns the new song + recordings + the voice blobs to write (key+base64),
 * which `importProjectBundle` persists. No I/O here, so it's unit-testable.
 */
export function remapProject(bundle: ProjectBundle): {
  song: Arrangement;
  recordings: Recording[];
  blobs: { key: string; base64: string; mime: string }[];
} {
  const recIdMap = new Map<string, string>();
  const recordings: Recording[] = [];
  const blobs: { key: string; base64: string; mime: string }[] = [];

  for (const er of bundle.recordings) {
    const newRecId = newId();
    recIdMap.set(er.id, newRecId);
    const { audioBase64, ...rec } = er;
    let audio = rec.audio;
    if (rec.kind === "voice" && rec.audio && audioBase64) {
      const key = newBlobKey();
      audio = { ...rec.audio, blobKey: key };
      blobs.push({ key, base64: audioBase64, mime: rec.audio.mimeType });
    }
    recordings.push({ ...rec, id: newRecId, audio });
  }

  const song: Arrangement = {
    ...bundle.song,
    id: newId(),
    createdAt: Date.now(),
    tracks: bundle.song.tracks.map((t) => ({
      ...t,
      id: newId(),
      clips: t.clips.map((c) => ({
        ...c,
        id: newId(),
        recordingId: recIdMap.get(c.recordingId) ?? c.recordingId,
      })),
    })),
  };

  return { song, recordings, blobs };
}

/** Remap a bundle and persist its voice blobs to IndexedDB. Returns the song + recordings to add. */
export async function importProjectBundle(
  bundle: ProjectBundle,
): Promise<{ song: Arrangement; recordings: Recording[] }> {
  const { song, recordings, blobs } = remapProject(bundle);
  for (const b of blobs) {
    await putBlob(b.key, new Blob([base64ToBytes(b.base64)], { type: b.mime }));
  }
  return { song, recordings };
}
