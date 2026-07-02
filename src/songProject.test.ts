import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory voiceStore stub so importProjectBundle's blob writes (and the partial-failure
// cleanup, DEBT-034) are testable without IndexedDB. remap/parse are pure and unaffected.
const { putBlob, deleteBlob, getBlob, newBlobKey } = vi.hoisted(() => {
  let n = 0;
  return {
    putBlob: vi.fn((_key: string, _blob: Blob) => Promise.resolve()),
    deleteBlob: vi.fn((_key: string) => Promise.resolve()),
    getBlob: vi.fn(() => Promise.resolve(null)),
    newBlobKey: vi.fn(() => `key-${++n}`),
  };
});
vi.mock("./voiceStore", () => ({ putBlob, deleteBlob, getBlob, newBlobKey }));

import {
  collectReferencedRecordingIds,
  parseProjectBundle,
  remapProject,
  importProjectBundle,
  serializeProject,
  PROJECT_FORMAT,
  type ProjectBundle,
} from "./songProject";
import type { Arrangement } from "./arrangement";

beforeEach(() => {
  putBlob.mockClear().mockImplementation(() => Promise.resolve());
  deleteBlob.mockClear();
});

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

  it("rejects internally-malformed bundles (DEBT-034: they must not reach remap or persist)", () => {
    // A recording whose events isn't an array used to pass validation and persist into the
    // library, crashing preview/flatten later.
    const badEvents = bundle();
    (badEvents.recordings[0] as { events: unknown }).events = "corrupt";
    expect(() => parseProjectBundle(serializeProject(badEvents))).toThrow(/malformed recording/i);

    const badTrack = bundle();
    (badTrack.song.tracks[0] as { clips: unknown }).clips = { not: "an array" };
    expect(() => parseProjectBundle(serializeProject(badTrack))).toThrow(/malformed track/i);

    const badAudio = bundle();
    (badAudio.recordings[1] as { audioBase64: unknown }).audioBase64 = 12345;
    expect(() => parseProjectBundle(serializeProject(badAudio))).toThrow(/malformed voice/i);

    const badId = bundle();
    (badId.recordings[0] as { id: unknown }).id = null;
    expect(() => parseProjectBundle(serializeProject(badId))).toThrow(/malformed recording/i);
  });
});

describe("importProjectBundle — partial-failure cleanup (DEBT-034)", () => {
  it("writes voice blobs and returns the remapped song + exactly the keys it wrote", async () => {
    const { song: s, recordings, writtenBlobKeys } = await importProjectBundle(bundle());
    expect(putBlob).toHaveBeenCalledTimes(1); // the one voice take
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(s.tracks[0].clips[1].recordingId).toBe(recordings[1].id);
    expect(writtenBlobKeys).toEqual([recordings[1].audio?.blobKey]); // only the fresh key
  });

  it("a voice take WITHOUT embedded audio keeps its original key and is NOT in writtenBlobKeys", async () => {
    const b = bundle();
    delete (b.recordings[1] as { audioBase64?: string }).audioBase64;
    const { recordings, writtenBlobKeys } = await importProjectBundle(b);
    expect(recordings[1].audio?.blobKey).toBe("oldkey"); // aliases the exporter's key
    expect(writtenBlobKeys).toEqual([]); // so cleanup must never touch it
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("deletes already-written blobs and rethrows when a write fails mid-import", async () => {
    // Two voice takes → first write succeeds, second throws → the first must be cleaned up.
    const b = bundle();
    b.recordings.push({ ...b.recordings[1], id: "voi2" });
    putBlob.mockImplementationOnce(() => Promise.resolve()).mockImplementationOnce(() => Promise.reject(new Error("idb full")));

    await expect(importProjectBundle(b)).rejects.toThrow("idb full");
    expect(deleteBlob).toHaveBeenCalledTimes(1);
    const writtenKey = putBlob.mock.calls[0][0]; // the key that DID land
    expect(deleteBlob).toHaveBeenCalledWith(writtenKey);
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
