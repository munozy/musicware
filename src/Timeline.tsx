/**
 * Timeline — ruler + track lanes + clip blocks + animated playhead.
 *
 * Drop math (the px→ms risk, pure-tested in timeScale):
 *   offsetPx  = clamp(clientX − lane.left [− grabOffset for a move], 0, lane.width)
 *   startMs   = snapMs(pxToMs(offsetPx, PX_PER_MS), SNAP_MS)
 *
 * Two drop payloads on text/plain:
 *   "clip:<recordingId>"            — a new clip dragged from the shelf
 *   "move:<clipId>:<grabOffsetPx>"  — an existing clip dragged within the timeline
 * Placed clips are keyboard-movable (focus + Left/Right) and removable (Delete / ✕).
 * The ruler is offset by LANE_ORIGIN_PX (CSS) so ticks line up with clip positions.
 * SNAP_MS = 100 keeps things usable; the full bar/beat grid is Slice 7.
 */

import { useRef } from "react";
import type { Arrangement, ClipInstance } from "./arrangement";
import type { Recording } from "./recordings";
import { pxToMs, msToPx, snapMs, PX_PER_MS } from "./timeScale";
import TrackHeader from "./TrackHeader";
import Playhead from "./Playhead";

const SNAP_MS = 100;
const RULER_TICK_MS = 1000;
const RULER_WIDTH_MS = 30_000; // show 30 seconds of ruler

export type TrackOps = {
  onAddTrack: () => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onSetTrackColor: (trackId: string, color: string) => void;
  onReorderTrack: (trackId: string, dir: "up" | "down") => void;
  onRemoveTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
};

type Props = {
  arrangement: Arrangement;
  recordings: Recording[];
  isPlaying: boolean;
  playStartedAt: number | null;
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip: (clipId: string) => void;
  onToggleClipMute: (clipId: string) => void;
  trackOps: TrackOps;
};

function ClipBlock({
  clip,
  recordings,
  onMoveClip,
  onRemoveClip,
  onToggleClipMute,
}: {
  clip: ClipInstance;
  recordings: Recording[];
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip: (clipId: string) => void;
  onToggleClipMute: (clipId: string) => void;
}) {
  const rec = recordings.find((r) => r.id === clip.recordingId);
  const name = rec?.name ?? clip.recordingId;
  const widthPx = rec ? Math.max(4, msToPx(rec.durationMs, PX_PER_MS)) : 4;
  const leftPx = msToPx(clip.startMs, PX_PER_MS);

  const handleDragStart = (e: React.DragEvent) => {
    const grabOffsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    e.dataTransfer.setData("text/plain", `move:${clip.id}:${Math.max(0, grabOffsetPx)}`);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMoveClip(clip.id, clip.startMs - SNAP_MS); // store clamps >= 0
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onMoveClip(clip.id, clip.startMs + SNAP_MS);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemoveClip(clip.id);
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      onToggleClipMute(clip.id);
    }
  };

  return (
    <div
      className={`timeline-clip${clip.muted ? " muted" : ""}`}
      style={{ left: leftPx, width: widthPx }}
      title={name}
      draggable
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${name} clip at ${(clip.startMs / 1000).toFixed(1)} seconds${clip.muted ? ", muted" : ""}. Drag or arrow keys to move; M to mute; Delete to remove.`}
    >
      <span className="timeline-clip-label">{name}</span>
      <button
        className={`timeline-clip-mute${clip.muted ? " active" : ""}`}
        aria-label={`${clip.muted ? "Unmute" : "Mute"} ${name} clip`}
        aria-pressed={clip.muted ?? false}
        title={clip.muted ? "Unmute" : "Mute"}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleClipMute(clip.id);
        }}
      >
        M
      </button>
      <button
        className="timeline-clip-delete"
        aria-label={`Remove ${name} clip`}
        title="Remove"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemoveClip(clip.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

function TrackLane({
  trackId,
  clips,
  recordings,
  onPlaceClip,
  onMoveClip,
  onRemoveClip,
  onToggleClipMute,
}: {
  trackId: string;
  clips: ClipInstance[];
  recordings: Recording[];
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip: (clipId: string) => void;
  onToggleClipMute: (clipId: string) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* jsdom */
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData("text/plain");
    const rect = laneRef.current?.getBoundingClientRect();
    const laneLeft = rect ? rect.left : 0;
    const laneWidth = rect ? rect.width : Number.POSITIVE_INFINITY;

    if (payload.startsWith("clip:")) {
      const recordingId = payload.slice("clip:".length);
      const offsetPx = Math.min(Math.max(0, e.clientX - laneLeft), laneWidth);
      onPlaceClip(trackId, recordingId, snapMs(pxToMs(offsetPx, PX_PER_MS), SNAP_MS));
    } else if (payload.startsWith("move:")) {
      const rest = payload.slice("move:".length);
      const sep = rest.lastIndexOf(":");
      const clipId = sep >= 0 ? rest.slice(0, sep) : rest;
      const grabOffsetPx = sep >= 0 ? Number(rest.slice(sep + 1)) || 0 : 0;
      const leftPx = Math.min(Math.max(0, e.clientX - laneLeft - grabOffsetPx), laneWidth);
      onMoveClip(clipId, snapMs(pxToMs(leftPx, PX_PER_MS), SNAP_MS));
    }
  };

  return (
    <div
      ref={laneRef}
      className="timeline-lane"
      data-testid={`lane-${trackId}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          recordings={recordings}
          onMoveClip={onMoveClip}
          onRemoveClip={onRemoveClip}
          onToggleClipMute={onToggleClipMute}
        />
      ))}
    </div>
  );
}

function Ruler() {
  const ticks = [];
  for (let ms = 0; ms <= RULER_WIDTH_MS; ms += RULER_TICK_MS) {
    const px = msToPx(ms, PX_PER_MS);
    const label = ms === 0 ? "0" : `${ms / 1000}s`;
    ticks.push(
      <div key={ms} className="ruler-tick" style={{ left: px }}>
        <span className="ruler-label">{label}</span>
      </div>,
    );
  }
  return <div className="timeline-ruler">{ticks}</div>;
}

export default function Timeline({
  arrangement,
  recordings,
  isPlaying,
  playStartedAt,
  onPlaceClip,
  onMoveClip,
  onRemoveClip,
  onToggleClipMute,
  trackOps,
}: Props) {
  return (
    <div className="timeline" role="region" aria-label="Timeline">
      <Ruler />
      <div className="timeline-tracks">
        {arrangement.tracks.map((track, i) => (
          <div key={track.id} className="timeline-track-row">
            <TrackHeader
              track={track}
              index={i}
              trackCount={arrangement.tracks.length}
              onRename={trackOps.onRenameTrack}
              onSetColor={trackOps.onSetTrackColor}
              onReorder={trackOps.onReorderTrack}
              onRemove={trackOps.onRemoveTrack}
              onToggleMute={trackOps.onToggleMute}
              onToggleSolo={trackOps.onToggleSolo}
            />
            <TrackLane
              trackId={track.id}
              clips={track.clips}
              recordings={recordings}
              onPlaceClip={onPlaceClip}
              onMoveClip={onMoveClip}
              onRemoveClip={onRemoveClip}
              onToggleClipMute={onToggleClipMute}
            />
          </div>
        ))}
      </div>
      <button className="timeline-add-track" onClick={trackOps.onAddTrack}>
        + Add track
      </button>
      <Playhead isPlaying={isPlaying} playStartedAt={playStartedAt} />
    </div>
  );
}
