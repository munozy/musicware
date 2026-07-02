/**
 * Video-project export/import (.mwvid) — a portable snapshot of a video clip: its image
 * slideshow (bytes embedded as base64) PLUS the soundtrack as a full song bundle (the
 * arrangement + every recording it uses, reusing songProject's ProjectBundle). So a .mwvid
 * reconstructs exactly — the song and its recordings come along, re-imported with fresh ids.
 */

import {
  buildProjectBundle,
  importProjectBundle,
  validateProjectBundle,
  bytesToBase64,
  base64ToBytes,
  type ProjectBundle,
} from "./songProject";
import { getBlob, putBlob, deleteBlob } from "./voiceStore";
import { newImageKey, type VideoImage, type VideoProject } from "./videoStore";
import { newId, type Recording } from "./recordings";
import type { Arrangement } from "./arrangement";

export const VIDEO_FORMAT = "musicware.videoproject";
export const VIDEO_VERSION = 1;
export const VIDEO_EXT = "mwvid";

type ExportedImage = { id: string; name: string; mimeType: string; durationMs: number; dataBase64: string };

export type VideoBundle = {
  format: typeof VIDEO_FORMAT;
  version: number;
  exportedAt: number;
  video: { name: string; images: ExportedImage[] };
  song: ProjectBundle | null; // the soundtrack (arrangement + its recordings), or null if none chosen
};

/** Build a .mwvid bundle: embed the images (base64) + the soundtrack song bundle (if any). */
export async function buildVideoBundle(
  project: VideoProject,
  songArrangement: Arrangement | null,
  recordings: Recording[],
): Promise<VideoBundle> {
  const images: ExportedImage[] = [];
  for (const img of project.images) {
    const blob = await getBlob(img.imageKey);
    images.push({
      id: img.id,
      name: img.name,
      mimeType: img.mimeType,
      durationMs: img.durationMs,
      dataBase64: blob ? bytesToBase64(new Uint8Array(await blob.arrayBuffer())) : "",
    });
  }
  const song = songArrangement ? await buildProjectBundle(songArrangement, recordings) : null;
  return { format: VIDEO_FORMAT, version: VIDEO_VERSION, exportedAt: Date.now(), video: { name: project.name, images }, song };
}

export function serializeVideoBundle(bundle: VideoBundle): string {
  return JSON.stringify(bundle);
}

/** Parse + validate a .mwvid file's text. Throws a friendly Error on anything malformed. */
export function parseVideoBundle(text: string): VideoBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = parsed as Partial<VideoBundle> | null;
  if (!b || typeof b !== "object" || b.format !== VIDEO_FORMAT) {
    throw new Error("That isn't a musicware video-project file.");
  }
  if (b.version !== VIDEO_VERSION) {
    throw new Error(`Unsupported video-project version (${String(b.version)}).`);
  }
  if (!b.video || !Array.isArray(b.video.images)) {
    throw new Error("The video-project file is missing its images.");
  }
  // Per-image structure (DEBT-034): the import base64-decodes and Blob-wraps each one without
  // further guards, so reject malformed entries here with a friendly message.
  for (const img of b.video.images as unknown[]) {
    const i = (img ?? {}) as Partial<ExportedImage>;
    if (!img || typeof img !== "object" || typeof i.dataBase64 !== "string" || typeof i.mimeType !== "string") {
      throw new Error("The video-project file has a malformed image.");
    }
  }
  // The embedded soundtrack is a FULL song ProjectBundle — run it through the same validation
  // the .mwsong path gets, or junk recordings slip straight into the library (DEBT-034 r3).
  if (b.song != null) {
    try {
      validateProjectBundle(b.song);
    } catch (e) {
      throw new Error(`The video-project's embedded song is invalid: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return b as VideoBundle;
}

/**
 * PURE remap of a bundle's images into fresh VideoImages (new ids + blob keys), returning the
 * images plus the blobs to write (key + base64). No I/O — unit-testable.
 */
export function remapVideoImages(bundle: VideoBundle): {
  images: VideoImage[];
  blobs: { key: string; base64: string; mime: string }[];
} {
  const images: VideoImage[] = [];
  const blobs: { key: string; base64: string; mime: string }[] = [];
  for (const ei of bundle.video.images) {
    const key = newImageKey();
    images.push({ id: newId(), name: ei.name, imageKey: key, mimeType: ei.mimeType, durationMs: ei.durationMs });
    blobs.push({ key, base64: ei.dataBase64, mime: ei.mimeType });
  }
  return { images, blobs };
}

/**
 * Import a .mwvid: re-import the embedded song (fresh ids + recordings, via songProject), write
 * the image blobs (fresh keys) to IndexedDB, and assemble a fresh VideoProject pointing at them.
 * Returns the project plus the song + recordings to add to their libraries (null if no song).
 */
export async function importVideoBundle(bundle: VideoBundle): Promise<{
  project: VideoProject;
  song: Arrangement | null;
  recordings: Recording[];
}> {
  let song: Arrangement | null = null;
  let recordings: Recording[] = [];
  let songBlobKeys: string[] = [];
  let songId = "";
  if (bundle.song) {
    const r = await importProjectBundle(bundle.song);
    song = r.song;
    recordings = r.recordings;
    songBlobKeys = r.writtenBlobKeys;
    songId = song.id;
  }

  const { images, blobs } = remapVideoImages(bundle);
  // Write-all-or-clean-up (DEBT-034): if an image blob write fails, the project is never added,
  // so delete the partial image writes AND the voice blobs the song import just wrote (ONLY
  // those — a recording without embedded audio kept its original key, which may alias a blob
  // already in this library), then rethrow for the friendly message.
  const written: string[] = [];
  try {
    for (const b of blobs) {
      if (b.base64) {
        await putBlob(b.key, new Blob([base64ToBytes(b.base64)], { type: b.mime }));
        written.push(b.key);
      }
    }
  } catch (e) {
    for (const key of [...written, ...songBlobKeys]) {
      try {
        await deleteBlob(key);
      } catch {
        /* best-effort */
      }
    }
    throw e;
  }

  const project: VideoProject = {
    id: newId(),
    name: bundle.video.name || "Imported video",
    createdAt: Date.now(),
    songId,
    images,
  };
  return { project, song, recordings };
}
