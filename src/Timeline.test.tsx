import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Timeline, { type TrackOps } from "./Timeline";
import { newArrangement } from "./arrangementStore";
import type { Arrangement, ClipInstance } from "./arrangement";
import type { Recording } from "./recordings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const makeRec = (id: string, durationMs = 2000): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs,
  events: [],
});

const makeVoiceRec = (id: string, durationMs = 1500): Recording => ({
  id,
  name: id,
  createdAt: 0,
  durationMs,
  kind: "voice",
  events: [],
  audio: { blobKey: `b-${id}`, mimeType: "audio/webm", effect: "none" },
});

const LANE_RECT = {
  left: 0, top: 0, width: 800, height: 60, right: 800, bottom: 60, x: 0, y: 0, toJSON: () => ({}),
} as DOMRect;

const withClip = (startMs: number, extra: Partial<ClipInstance> = {}) => {
  const arr = newArrangement();
  const tid = arr.tracks[0].id;
  const clip: ClipInstance = { id: "clip-1", recordingId: "r1", startMs, transpose: 0, loopCount: 1, ...extra };
  const arr2: Arrangement = {
    ...arr,
    tracks: arr.tracks.map((t) => (t.id === tid ? { ...t, clips: [clip] } : t)),
  };
  return { arr: arr2, tid };
};

describe("Timeline", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onPlaceClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onMoveClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onAddTrack: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onRemoveClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onToggleClipMute: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onDuplicateClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onSetClipLoop: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onTransposeClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onTrimClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onSetClipEffect: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onSelectClip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onClearSelection: any;
  let selectedIds: Set<string>;
  let trackOps: TrackOps;

  beforeEach(() => {
    onPlaceClip = vi.fn();
    onSelectClip = vi.fn();
    onClearSelection = vi.fn();
    selectedIds = new Set<string>();
    onMoveClip = vi.fn();
    onAddTrack = vi.fn();
    onRemoveClip = vi.fn();
    onToggleClipMute = vi.fn();
    onDuplicateClip = vi.fn();
    onSetClipLoop = vi.fn();
    onTransposeClip = vi.fn();
    onTrimClip = vi.fn();
    onSetClipEffect = vi.fn();
    trackOps = {
      onAddTrack,
      onRenameTrack: vi.fn(),
      onSetTrackColor: vi.fn(),
      onReorderTrack: vi.fn(),
      onRemoveTrack: vi.fn(),
      onToggleMute: vi.fn(),
      onToggleSolo: vi.fn(),
    };
  });

  const renderTL = (arr: Arrangement, recordings: Recording[] = []) =>
    render(
      <Timeline
        arrangement={arr}
        recordings={recordings}
        isPlaying={false}
        playStartedAt={null}
        gridMs={100}
        onPlaceClip={onPlaceClip}
        clipOps={{ onMoveClip, onRemoveClip, onToggleClipMute, onDuplicateClip, onSetClipLoop, onTransposeClip, onTrimClip, onSetClipEffect }}
        trackOps={trackOps}
        sectionOps={{
          onAddSection: vi.fn(),
          onRenameSection: vi.fn(),
          onMoveSection: vi.fn(),
          onResizeSection: vi.fn(),
          onRemoveSection: vi.fn(),
          onApplyTemplate: vi.fn(),
          onSuggestSection: vi.fn(),
        }}
        selection={{ selectedIds, onSelectClip, onClearSelection }}
        seekMs={0}
        loopRegion={null}
        loopEnabled={false}
        playOriginMs={0}
        playLoopLenMs={0}
        onSeek={vi.fn()}
        onSetLoopRegion={vi.fn()}
      />,
    );

  it("renders a track lane", () => {
    renderTL(newArrangement());
    expect(screen.getByRole("region", { name: /timeline/i })).toBeDefined();
  });

  it("drop with a clip: payload calls onPlaceClip with the exact computed startMs", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    renderTL(arr, [makeRec("r1")]);
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT);

    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 100 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);

    expect(onPlaceClip).toHaveBeenCalledOnce();
    const [calledTrackId, calledRecId, calledStartMs] = onPlaceClip.mock.calls[0];
    expect(calledTrackId).toBe(trackId);
    expect(calledRecId).toBe("r1");
    // 100px / 0.04 = 2500ms, snapped to 100 = 2500ms — pins the px→ms→snap pipeline.
    expect(calledStartMs).toBe(2500);
  });

  it("subtracts the lane's left offset and snaps to the 100ms grid (round)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    renderTL(arr, [makeRec("r1")]);
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => ({ ...LANE_RECT, left: 40, right: 840, x: 40 }) as DOMRect);
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 143 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);
    // (143 − 40) = 103px → 103/0.04 = 2575ms → round to nearest 100 = 2600ms
    expect(onPlaceClip.mock.calls[0][2]).toBe(2600);
  });

  it("clamps a drop past the lane width to the end (no off-the-end placement)", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    renderTL(arr, [makeRec("r1")]);
    const lane = screen.getByTestId(`lane-${trackId}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT); // width 800
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 5000 });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "clip:r1", dropEffect: "copy" } });
    lane.dispatchEvent(dropEvent);
    // clamped to width 800 → 800/0.04 = 20000ms
    expect(onPlaceClip.mock.calls[0][2]).toBe(20000);
  });

  it("drop with a move: payload calls onMoveClip with the grab-offset-corrected startMs", () => {
    const { arr, tid } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    const lane = screen.getByTestId(`lane-${tid}`);
    lane.getBoundingClientRect = vi.fn(() => LANE_RECT);
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 240 });
    // grabOffset 40 → left edge = 240 − 0 − 40 = 200px → 200/0.04 = 5000ms
    Object.defineProperty(dropEvent, "dataTransfer", { value: { getData: () => "move:clip-1:40", dropEffect: "move" } });
    lane.dispatchEvent(dropEvent);
    expect(onMoveClip).toHaveBeenCalledWith("clip-1", 5000);
    expect(onPlaceClip).not.toHaveBeenCalled();
  });

  it("a focused placed clip moves with Left/Right arrow keys (keyboard nudge)", () => {
    const { arr } = withClip(1000);
    renderTL(arr, [makeRec("r1")]);
    const block = screen.getByRole("button", { name: /r1 clip at/i });
    fireEvent.keyDown(block, { key: "ArrowRight" });
    expect(onMoveClip).toHaveBeenLastCalledWith("clip-1", 1100);
    fireEvent.keyDown(block, { key: "ArrowLeft" });
    expect(onMoveClip).toHaveBeenLastCalledWith("clip-1", 900);
  });

  it("the clip ✕ button removes the clip", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    fireEvent.click(screen.getByRole("button", { name: /remove r1 clip/i }));
    expect(onRemoveClip).toHaveBeenCalledWith("clip-1");
  });

  it("Delete on a focused clip removes it", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    fireEvent.keyDown(screen.getByRole("button", { name: /r1 clip at/i }), { key: "Delete" });
    expect(onRemoveClip).toHaveBeenCalledWith("clip-1");
  });

  it("the clip M button toggles per-clip mute", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    fireEvent.click(screen.getByRole("button", { name: /mute r1 clip/i }));
    expect(onToggleClipMute).toHaveBeenCalledWith("clip-1");
  });

  it("the + Add track button calls onAddTrack", () => {
    renderTL(newArrangement());
    fireEvent.click(screen.getByRole("button", { name: /add track/i }));
    expect(onAddTrack).toHaveBeenCalledOnce();
  });

  it("renders placed clips as labelled blocks", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1", 1000)]);
    expect(screen.getByText("r1")).toBeDefined();
  });

  it("allows dragOver on a lane without throwing", () => {
    const arr = newArrangement();
    const trackId = arr.tracks[0].id;
    renderTL(arr);
    const lane = screen.getByTestId(`lane-${trackId}`);
    expect(() => fireEvent.dragOver(lane)).not.toThrow();
  });

  // ---- Slice 5: clip editing (duplicate / loop / transpose) ----

  it("the ⧉ button duplicates the clip just after it (startMs + played length)", () => {
    const { arr } = withClip(0); // rec durationMs 2000, loopCount 1 → played 2000ms
    renderTL(arr, [makeRec("r1", 2000)]);
    fireEvent.click(screen.getByRole("button", { name: /duplicate r1 clip/i }));
    expect(onDuplicateClip).toHaveBeenCalledWith("clip-1", 2000);
  });

  it("D on a focused clip duplicates it; the copy abuts after the LOOPED length", () => {
    const { arr } = withClip(500, { loopCount: 2 }); // played 2000×2 = 4000ms; abut at 500+4000
    renderTL(arr, [makeRec("r1", 2000)]);
    fireEvent.keyDown(screen.getByRole("button", { name: /r1 clip at/i }), { key: "d" });
    expect(onDuplicateClip).toHaveBeenCalledWith("clip-1", 4500);
  });

  it("loop steppers and [ ] keys change the loop count", () => {
    const { arr } = withClip(0, { loopCount: 2 });
    renderTL(arr, [makeRec("r1")]);
    fireEvent.click(screen.getByRole("button", { name: /loop more/i }));
    expect(onSetClipLoop).toHaveBeenLastCalledWith("clip-1", 3);
    fireEvent.click(screen.getByRole("button", { name: /loop fewer/i }));
    expect(onSetClipLoop).toHaveBeenLastCalledWith("clip-1", 1);
    const block = screen.getByRole("button", { name: /r1 clip at/i });
    fireEvent.keyDown(block, { key: "]" });
    expect(onSetClipLoop).toHaveBeenLastCalledWith("clip-1", 3);
    fireEvent.keyDown(block, { key: "[" });
    expect(onSetClipLoop).toHaveBeenLastCalledWith("clip-1", 1);
  });

  it("transpose steppers and Up/Down keys change the transpose", () => {
    const { arr } = withClip(0, { transpose: 0 });
    renderTL(arr, [makeRec("r1")]);
    fireEvent.click(screen.getByRole("button", { name: /transpose up/i }));
    expect(onTransposeClip).toHaveBeenLastCalledWith("clip-1", 1);
    fireEvent.click(screen.getByRole("button", { name: /transpose down/i }));
    expect(onTransposeClip).toHaveBeenLastCalledWith("clip-1", -1);
    const block = screen.getByRole("button", { name: /r1 clip at/i });
    fireEvent.keyDown(block, { key: "ArrowUp" });
    expect(onTransposeClip).toHaveBeenLastCalledWith("clip-1", 1);
    fireEvent.keyDown(block, { key: "ArrowDown" });
    expect(onTransposeClip).toHaveBeenLastCalledWith("clip-1", -1);
  });

  it("clip width reflects the looped length (×2 is twice as wide as ×1)", () => {
    const single = withClip(0, { loopCount: 1 });
    const { container, unmount } = renderTL(single.arr, [makeRec("r1", 2000)]);
    const w1 = (container.querySelector(".timeline-clip") as HTMLElement).style.width;
    unmount();
    const double = withClip(0, { loopCount: 2 });
    const { container: c2 } = renderTL(double.arr, [makeRec("r1", 2000)]);
    const w2 = (c2.querySelector(".timeline-clip") as HTMLElement).style.width;
    expect(w1).toBe("80px"); // 2000ms × 0.04 px/ms
    expect(w2).toBe("160px"); // 4000ms × 0.04 px/ms
  });

  it("a VOICE clip shows an effect picker (not a transpose stepper) and changing it sets the effect", () => {
    const { arr } = withClip(0); // recordingId "r1"
    renderTL(arr, [makeVoiceRec("r1")]);
    expect(screen.queryByRole("button", { name: /transpose up/i })).toBeNull(); // no transpose for audio
    fireEvent.change(screen.getByRole("combobox", { name: /effect for r1 clip/i }), {
      target: { value: "robot" },
    });
    expect(onSetClipEffect).toHaveBeenCalledWith("clip-1", "robot");
  });

  it("a KEYBOARD clip shows the transpose stepper, not an effect picker", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    expect(screen.queryByRole("combobox", { name: /effect for/i })).toBeNull();
    expect(screen.getByRole("button", { name: /transpose up/i })).toBeDefined();
  });

  it("clicking a clip selects it; Shift/⌘-click selects additively", () => {
    const { arr } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    const block = screen.getByRole("button", { name: /r1 clip at/i });
    fireEvent.click(block);
    expect(onSelectClip).toHaveBeenLastCalledWith("clip-1", false);
    fireEvent.click(block, { shiftKey: true });
    expect(onSelectClip).toHaveBeenLastCalledWith("clip-1", true);
    fireEvent.click(block, { metaKey: true });
    expect(onSelectClip).toHaveBeenLastCalledWith("clip-1", true);
  });

  it("clicking an empty lane clears the selection", () => {
    const { arr, tid } = withClip(0);
    renderTL(arr, [makeRec("r1")]);
    fireEvent.click(screen.getByTestId(`lane-${tid}`));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("a selected clip gets the 'selected' class", () => {
    const { arr } = withClip(0);
    selectedIds = new Set(["clip-1"]);
    const { container } = renderTL(arr, [makeRec("r1")]);
    expect(container.querySelector(".timeline-clip.selected")).not.toBeNull();
  });

  it("renders left and right trim handles on a clip", () => {
    const { arr } = withClip(0);
    const { container } = renderTL(arr, [makeRec("r1")]);
    expect(container.querySelector(".timeline-clip-trim-start")).not.toBeNull();
    expect(container.querySelector(".timeline-clip-trim-end")).not.toBeNull();
  });

  it("shows ×N and transpose badges only when non-default", () => {
    const plain = withClip(0);
    const { container, unmount } = renderTL(plain.arr, [makeRec("r1")]);
    expect(container.querySelector(".clip-badge-loop")).toBeNull();
    expect(container.querySelector(".clip-badge-transpose")).toBeNull();
    unmount();

    const edited = withClip(0, { loopCount: 2, transpose: 3 });
    const { container: c2 } = renderTL(edited.arr, [makeRec("r1")]);
    expect(c2.querySelector(".clip-badge-loop")?.textContent).toBe("×2");
    expect(c2.querySelector(".clip-badge-transpose")?.textContent).toBe("+3");
  });
});
