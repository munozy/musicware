import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { newId } from "./recordings";
import { getBlob, putBlob } from "./voiceStore";
import {
  loadVideoProjects,
  saveVideoProjects,
  newVideoProject,
  newImageKey,
  addImages,
  removeImage as removeImageOp,
  reorderImage as reorderImageOp,
  setImageDuration as setImageDurationOp,
  evenSplitDurations,
  setProjectSong,
  renameProject,
  DEFAULT_IMAGE_MS,
  type VideoImage,
  type VideoProject,
} from "./videoStore";

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};
const IMAGE_EXTS = Object.keys(EXT_MIME);

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const extOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "png";

/**
 * Video-project library + active project (ADR-0010). Mirrors useArrangement's library shape:
 * a stable setActiveProject updates the active one in place. Owns image import (dialog → fs →
 * IndexedDB) and the object URLs used for thumbnails/preview (created for the active project's
 * images, revoked when the set changes or on unmount).
 */
export function useVideo() {
  const initial = useState(() => loadVideoProjects())[0];
  const [projects, setProjects] = useState<VideoProject[]>(initial.projects);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [importing, setImporting] = useState(false);

  const project = projects.find((p) => p.id === activeId) ?? projects[0];

  const setActiveProject = useCallback((updater: VideoProject | ((p: VideoProject) => VideoProject)) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeIdRef.current ? (typeof updater === "function" ? (updater as (x: VideoProject) => VideoProject)(p) : updater) : p,
      ),
    );
  }, []);

  useEffect(() => {
    saveVideoProjects(projects, activeId);
  }, [projects, activeId]);

  // Object URLs for the active project's images (thumbnails + preview). Recreated only when the
  // SET of images changes (keyed by imageKey), not on duration edits; revoked on change/unmount.
  const imageKeysSig = project.images.map((i) => i.imageKey).join(",");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    (async () => {
      for (const img of project.images) {
        if (urls[img.imageKey]) continue;
        const blob = await getBlob(img.imageKey);
        if (cancelled) return;
        if (blob) urls[img.imageKey] = URL.createObjectURL(blob);
      }
      if (!cancelled) setImageUrls(urls);
    })();
    return () => {
      cancelled = true;
      for (const u of Object.values(urls)) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, imageKeysSig]);

  // ---- image import ----
  const importImages = useCallback(async () => {
    let selected: string | string[] | null = null;
    try {
      selected = await open({ multiple: true, filters: [{ name: "Images", extensions: IMAGE_EXTS }] });
    } catch (e) {
      console.error("image open dialog failed", e);
      return;
    }
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const imgs: VideoImage[] = [];
      for (const path of paths) {
        const mimeType = EXT_MIME[extOf(path)] ?? "image/png";
        const key = newImageKey();
        await putBlob(key, new Blob([await readFile(path)], { type: mimeType }));
        imgs.push({ id: newId(), name: basename(path), imageKey: key, mimeType, durationMs: DEFAULT_IMAGE_MS });
      }
      setActiveProject((p) => addImages(p, imgs));
    } catch (e) {
      console.error("image import failed", e);
    } finally {
      setImporting(false);
    }
  }, [setActiveProject]);

  // ---- image edits ----
  const removeImage = useCallback((id: string) => setActiveProject((p) => removeImageOp(p, id)), [setActiveProject]);
  const reorderImage = useCallback(
    (id: string, dir: "left" | "right") => setActiveProject((p) => reorderImageOp(p, id, dir)),
    [setActiveProject],
  );
  const setImageDuration = useCallback(
    (id: string, ms: number) => setActiveProject((p) => setImageDurationOp(p, id, ms)),
    [setActiveProject],
  );
  const fitToSong = useCallback((totalMs: number) => setActiveProject((p) => evenSplitDurations(p, totalMs)), [setActiveProject]);
  const setSong = useCallback((songId: string) => setActiveProject((p) => setProjectSong(p, songId)), [setActiveProject]);

  // ---- project CRUD ----
  const newProject = useCallback(() => {
    setProjects((prev) => {
      const p = newVideoProject(prev);
      setActiveId(p.id);
      return [...prev, p];
    });
  }, []);
  const selectProject = useCallback((id: string) => setActiveId(id), []);
  const renameActive = useCallback((name: string) => setActiveProject((p) => renameProject(p, name)), [setActiveProject]);
  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      if (id === activeIdRef.current) setActiveId(next[0].id);
      return next;
    });
  }, []);

  const projectRefs = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name })), [projects]);

  return {
    project,
    projects: projectRefs,
    activeId,
    importing,
    imageUrls,
    importImages,
    removeImage,
    reorderImage,
    setImageDuration,
    fitToSong,
    setSong,
    newProject,
    selectProject,
    renameActive,
    deleteProject,
  };
}
