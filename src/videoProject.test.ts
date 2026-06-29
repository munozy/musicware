import { describe, it, expect } from "vitest";
import {
  parseVideoBundle,
  remapVideoImages,
  serializeVideoBundle,
  VIDEO_FORMAT,
  type VideoBundle,
} from "./videoProject";

const bundle = (): VideoBundle => ({
  format: VIDEO_FORMAT,
  version: 1,
  exportedAt: 0,
  video: {
    name: "My Clip",
    images: [
      { id: "i1", name: "a.png", mimeType: "image/png", durationMs: 2000, dataBase64: "QQ==" },
      { id: "i2", name: "b.jpg", mimeType: "image/jpeg", durationMs: 3000, dataBase64: "Qg==" },
    ],
  },
  song: null,
});

describe("parseVideoBundle", () => {
  it("accepts a well-formed bundle (round-trips through serialize)", () => {
    const parsed = parseVideoBundle(serializeVideoBundle(bundle()));
    expect(parsed.format).toBe(VIDEO_FORMAT);
    expect(parsed.video.images).toHaveLength(2);
  });

  it("rejects bad JSON, wrong format, wrong version, and missing images", () => {
    expect(() => parseVideoBundle("{nope")).toThrow();
    expect(() => parseVideoBundle(JSON.stringify({ format: "x" }))).toThrow(/video-project/i);
    expect(() => parseVideoBundle(JSON.stringify({ format: VIDEO_FORMAT, version: 99 }))).toThrow(/version/i);
    expect(() => parseVideoBundle(JSON.stringify({ format: VIDEO_FORMAT, version: 1, video: {} }))).toThrow(/missing/i);
  });
});

describe("remapVideoImages", () => {
  it("assigns fresh ids + blob keys, preserving name/mime/duration, and collects the blobs", () => {
    const { images, blobs } = remapVideoImages(bundle());
    expect(images).toHaveLength(2);
    expect(images[0].id).not.toBe("i1");
    expect(images[0].imageKey).not.toBe("");
    expect(images[0]).toMatchObject({ name: "a.png", mimeType: "image/png", durationMs: 2000 });
    expect(images[1]).toMatchObject({ name: "b.jpg", mimeType: "image/jpeg", durationMs: 3000 });
    expect(blobs).toEqual([
      { key: images[0].imageKey, base64: "QQ==", mime: "image/png" },
      { key: images[1].imageKey, base64: "Qg==", mime: "image/jpeg" },
    ]);
  });

  it("gives unique keys across two imports (no collisions)", () => {
    const a = remapVideoImages(bundle());
    const b = remapVideoImages(bundle());
    expect(a.images[0].imageKey).not.toBe(b.images[0].imageKey);
    expect(a.images[0].id).not.toBe(b.images[0].id);
  });
});
