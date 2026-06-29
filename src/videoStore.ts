/**
 * Video-clip projects (ADR-0010): a soundtrack song + an ordered slideshow of images.
 * Image bytes live in IndexedDB (too big for localStorage; reuses the voiceStore blob KV);
 * project metadata lives in localStorage. Pure ops + persistence here; I/O (image import,
 * preview, export) lives in useVideo/VideoView.
 */

import { newId } from "./recordings";

const PROJECTS_KEY = "musicware.videoprojects.v1";
const ACTIVE_KEY = "musicware.activeVideo.v1";

export const DEFAULT_IMAGE_MS = 3000;
export const MIN_IMAGE_MS = 200;

export type VideoImage = {
  id: string;
  name: string;
  imageKey: string; // IndexedDB blob key
  mimeType: string;
  durationMs: number;
};

export type VideoProject = {
  id: string;
  name: string;
  createdAt: number;
  songId: string; // a saved song (Arrangement) used as the soundtrack; "" = none chosen yet
  images: VideoImage[];
};

/** A fresh blob key for an imported image. */
export function newImageKey(): string {
  return "img-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function nextVideoName(projects: VideoProject[]): string {
  let max = 0;
  for (const p of projects) {
    const m = /^Video (\d+)$/.exec(p.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Video ${max + 1}`;
}

export function newVideoProject(projects: VideoProject[], songId = ""): VideoProject {
  return { id: newId(), name: nextVideoName(projects), createdAt: Date.now(), songId, images: [] };
}

// ---- pure, immutable edits on a single project ----

export function setProjectSong(p: VideoProject, songId: string): VideoProject {
  return { ...p, songId };
}

export function renameProject(p: VideoProject, name: string): VideoProject {
  const trimmed = name.trim();
  return trimmed ? { ...p, name: trimmed } : p;
}

export function addImages(p: VideoProject, images: VideoImage[]): VideoProject {
  return images.length ? { ...p, images: [...p.images, ...images] } : p;
}

export function removeImage(p: VideoProject, imageId: string): VideoProject {
  if (!p.images.some((i) => i.id === imageId)) return p;
  return { ...p, images: p.images.filter((i) => i.id !== imageId) };
}

export function reorderImage(p: VideoProject, imageId: string, dir: "left" | "right"): VideoProject {
  const i = p.images.findIndex((im) => im.id === imageId);
  if (i === -1) return p;
  const j = dir === "left" ? i - 1 : i + 1;
  if (j < 0 || j >= p.images.length) return p;
  const images = [...p.images];
  [images[i], images[j]] = [images[j], images[i]];
  return { ...p, images };
}

export function setImageDuration(p: VideoProject, imageId: string, durationMs: number): VideoProject {
  const ms = Math.max(MIN_IMAGE_MS, Math.round(Number.isFinite(durationMs) ? durationMs : DEFAULT_IMAGE_MS));
  if (!p.images.some((i) => i.id === imageId)) return p;
  return { ...p, images: p.images.map((i) => (i.id === imageId ? { ...i, durationMs: ms } : i)) };
}

/** Split a total duration evenly across the images (the "fit to song" action). No-op if empty. */
export function evenSplitDurations(p: VideoProject, totalMs: number): VideoProject {
  if (p.images.length === 0) return p;
  const each = Math.max(MIN_IMAGE_MS, Math.round(totalMs / p.images.length));
  return { ...p, images: p.images.map((i) => ({ ...i, durationMs: each })) };
}

/** Total slideshow length (ms) — the sum of the image durations. */
export function imagesTotalMs(p: VideoProject): number {
  return p.images.reduce((n, i) => n + i.durationMs, 0);
}

// ---- persistence ----

function isProject(x: unknown): x is VideoProject {
  return !!x && typeof x === "object" && Array.isArray((x as VideoProject).images) && typeof (x as VideoProject).id === "string";
}

export function loadVideoProjects(): { projects: VideoProject[]; activeId: string } {
  let projects: VideoProject[] = [];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) projects = parsed.filter(isProject);
    }
  } catch {
    projects = [];
  }
  if (projects.length === 0) projects = [{ ...newVideoProject([]), name: "Video 1" }];

  let activeId = "";
  try {
    activeId = localStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    activeId = "";
  }
  if (!projects.some((p) => p.id === activeId)) activeId = projects[0].id;
  return { projects, activeId };
}

export function saveVideoProjects(projects: VideoProject[], activeId: string): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch (e) {
    console.error("failed to persist video projects", e);
  }
}
