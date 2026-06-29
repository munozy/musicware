import { describe, it, expect, beforeEach } from "vitest";
import {
  newVideoProject,
  nextVideoName,
  addImages,
  removeImage,
  reorderImage,
  setImageDuration,
  evenSplitDurations,
  imagesTotalMs,
  setProjectSong,
  renameProject,
  loadVideoProjects,
  saveVideoProjects,
  MIN_IMAGE_MS,
  DEFAULT_IMAGE_MS,
  type VideoImage,
  type VideoProject,
} from "./videoStore";

const img = (id: string, durationMs = DEFAULT_IMAGE_MS): VideoImage => ({
  id,
  name: `${id}.png`,
  imageKey: `key-${id}`,
  mimeType: "image/png",
  durationMs,
});

const withImages = (...ids: string[]): VideoProject => {
  let p = newVideoProject([]);
  p = addImages(p, ids.map((id) => img(id)));
  return p;
};

beforeEach(() => localStorage.clear());

describe("newVideoProject / nextVideoName", () => {
  it("names the next project 'Video N' (gap-safe) and starts empty", () => {
    const p = newVideoProject([]);
    expect(p.name).toBe("Video 1");
    expect(p.images).toEqual([]);
    expect(p.songId).toBe("");
    const list = [{ ...p, name: "Video 1" }, { ...newVideoProject([]), name: "Video 3" }];
    expect(nextVideoName(list)).toBe("Video 4");
  });
});

describe("image edits (pure/immutable)", () => {
  it("addImages appends; removeImage drops; both leave the original untouched", () => {
    const p = withImages("a", "b");
    expect(p.images.map((i) => i.id)).toEqual(["a", "b"]);
    const p2 = removeImage(p, "a");
    expect(p2.images.map((i) => i.id)).toEqual(["b"]);
    expect(p.images).toHaveLength(2); // original unchanged
    expect(removeImage(p, "nope")).toBe(p); // unknown id → same ref
  });

  it("reorderImage swaps neighbours and clamps at the ends", () => {
    const p = withImages("a", "b", "c");
    expect(reorderImage(p, "a", "right").images.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(reorderImage(p, "c", "left").images.map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(reorderImage(p, "a", "left")).toBe(p); // already first
    expect(reorderImage(p, "c", "right")).toBe(p); // already last
  });

  it("setImageDuration rounds + clamps to >= MIN_IMAGE_MS", () => {
    const p = withImages("a");
    expect(setImageDuration(p, "a", 1500.6).images[0].durationMs).toBe(1501);
    expect(setImageDuration(p, "a", 0).images[0].durationMs).toBe(MIN_IMAGE_MS);
    expect(setImageDuration(p, "a", -100).images[0].durationMs).toBe(MIN_IMAGE_MS);
  });

  it("evenSplitDurations divides a total across all images; imagesTotalMs sums them", () => {
    const p = evenSplitDurations(withImages("a", "b", "c", "d"), 8000);
    expect(p.images.every((i) => i.durationMs === 2000)).toBe(true);
    expect(imagesTotalMs(p)).toBe(8000);
    expect(evenSplitDurations(newVideoProject([]), 8000).images).toEqual([]); // no-op when empty
  });

  it("setProjectSong / renameProject", () => {
    const p = withImages("a");
    expect(setProjectSong(p, "song-9").songId).toBe("song-9");
    expect(renameProject(p, "  My Clip  ").name).toBe("My Clip");
    expect(renameProject(p, "   ")).toBe(p); // blank ignored
  });
});

describe("persistence", () => {
  it("returns one default project when nothing is stored", () => {
    const { projects, activeId } = loadVideoProjects();
    expect(projects).toHaveLength(1);
    expect(activeId).toBe(projects[0].id);
  });

  it("round-trips projects + active id; falls back to first when active id is unknown", () => {
    const a = newVideoProject([]);
    const b = { ...newVideoProject([a]), id: "vid-b" };
    saveVideoProjects([a, b], "vid-b");
    expect(loadVideoProjects().activeId).toBe("vid-b");
    saveVideoProjects([a, b], "ghost");
    expect(loadVideoProjects().activeId).toBe(a.id);
  });

  it("tolerates corrupt storage (bad JSON / non-array) → fresh default", () => {
    localStorage.setItem("musicware.videoprojects.v1", "{bad");
    expect(loadVideoProjects().projects).toHaveLength(1);
    localStorage.setItem("musicware.videoprojects.v1", JSON.stringify([{ nope: true }]));
    expect(loadVideoProjects().projects).toHaveLength(1);
  });
});
