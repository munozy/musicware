import { describe, it, expect } from "vitest";
import {
  collectReferencedRecordingIds,
  parseProjectBundle,
  remapProject,
  serializeProject,
  PROJECT_FORMAT,
  type ProjectBundle,
} from "./songProject";
import type { Arrangement } from "./arrangement";

const song = (): Arrangement => ({
  id: "song1",
  name: "My Song",
  createdAt: 0,
  tempoBpm: 120,
  timeSig: [4, 4],
  sections: [],
  tracks: [
    {
      id: "t1",
      name: "T1",
      color: "#fff",
      presetIndex: 0,
      muted: false,
      soloed: false,
      clips: [
        { id: "c1", recordingId: "kbd", startMs: 0, transpose: 0, loopCount: 1 },
        { id: "c2", recordingId: "voi", startMs: 1000, transpose: 2, loopCount: 3 },
      ],
    },
  ],
});

const bundle = (): ProjectBundle => ({
  format: PROJECT_FORMAT,
  version: 1,
  exportedAt: 0,
  song: song(),
  recordings: [
    {
      id: "kbd",
      name: "Kbd",
      createdAt: 0,
      durationMs: 1000,
      events: [
        { t: 0, kind: "preset", index: 0 },
        { t: 0, kind: "on", note: 60 },
        { t: 500, kind: "off", note: 60 },
      ],
    },
    {
      id: "voi",
      name: "Voice",
      createdAt: 0,
      durationMs: 1500,
      kind: "voice",
      events: [],
      audio: { blobKey: "oldkey", mimeType: "audio/webm", effect: "robot" },
      audioBase64: "QUJD", // "ABC"
    },
  ],
});

describe("collectReferencedRecordingIds", () => {
  it("gathers every recordingId referenced by the song's clips", () => {
    expect(collectReferencedRecordingIds(song())).toEqual(new Set(["kbd", "voi"]));
  });
});

describe("parseProjectBundle", () => {
  it("accepts a well-formed bundle (round-trips through serialize)", () => {
    const parsed = parseProjectBundle(serializeProject(bundle()));
    expect(parsed.format).toBe(PROJECT_FORMAT);
    expect(parsed.song.tracks[0].clips).toHaveLength(2);
  });

  it("rejects bad JSON, wrong format, wrong version, and missing pieces", () => {
    expect(() => parseProjectBundle("{not json")).toThrow();
    expect(() => parseProjectBundle(JSON.stringify({ format: "nope" }))).toThrow(/musicware/i);
    expect(() => parseProjectBundle(JSON.stringify({ format: PROJECT_FORMAT, version: 999 }))).toThrow(/version/i);
    expect(() => parseProjectBundle(JSON.stringify({ format: PROJECT_FORMAT, version: 1 }))).toThrow(/missing/i);
  });
});

describe("remapProject", () => {
  it("assigns fresh ids to the song, tracks, clips, and recordings", () => {
    const b = bundle();
    const { song: s, recordings } = remapProject(b);
    expect(s.id).not.toBe("song1");
    expect(s.tracks[0].id).not.toBe("t1");
    expect(s.tracks[0].clips[0].id).not.toBe("c1");
    expect(recordings[0].id).not.toBe("kbd");
    expect(recordings[1].id).not.toBe("voi");
  });

  it("rewires each clip's recordingId to the remapped recording", () => {
    const { song: s, recordings } = remapProject(bundle());
    expect(s.tracks[0].clips[0].recordingId).toBe(recordings[0].id); // was "kbd"
    expect(s.tracks[0].clips[1].recordingId).toBe(recordings[1].id); // was "voi"
  });

  it("preserves clip edits and keyboard events; gives voice takes a fresh blob key + a blob to write", () => {
    const { recordings, blobs } = remapProject(bundle());
    // clip edits carried through
    const s = remapProject(bundle()).song;
    expect(s.tracks[0].clips[1]).toMatchObject({ transpose: 2, loopCount: 3, startMs: 1000 });
    // keyboard events intact
    expect(recordings[0].events).toHaveLength(3);
    // voice: new blob key, base64 collected, audioBase64 stripped from the stored recording
    expect(recordings[1].audio?.blobKey).not.toBe("oldkey");
    expect(recordings[1].audio?.effect).toBe("robot");
    expect((recordings[1] as { audioBase64?: string }).audioBase64).toBeUndefined();
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toMatchObject({ key: recordings[1].audio?.blobKey, base64: "QUJD", mime: "audio/webm" });
  });

  it("produces unique ids across two imports of the same bundle (no collisions)", () => {
    const a = remapProject(bundle());
    const b = remapProject(bundle());
    expect(a.song.id).not.toBe(b.song.id);
    expect(a.recordings[0].id).not.toBe(b.recordings[0].id);
  });
});
