/**
 * Timeline — ruler + track lanes + clip blocks + static playhead.
 *
 * Drop math (the flagged px→ms risk):
 *   PX_PER_SEC = 40  →  pxPerMs = 40 / 1000 = 0.04
 *   offsetPx  = clientX − lane.getBoundingClientRect().left
 *   startMs   = snapMs(pxToMs(offsetPx, pxPerMs), SNAP_MS)
 *
 * SNAP_MS = 100 keeps Slice 1 usable while snapping is a Slice 7 feature.
 * The Timeline exports PX_PER_SEC so tests and SongView can reference it.
 */

import { useRef } from "react";
import type { Arrangement, ClipInstance } from "./arrangement";
import type { Recording } from "./recordings";
import { pxToMs, msToPx, snapMs } from "./timeScale";

export const PX_PER_SEC = 40;
const PX_PER_MS = PX_PER_SEC / 1000;
const SNAP_MS = 100;

// Ruler tick interval in ms (every 1 second for Slice 1).
const RULER_TICK_MS = 1000;
const RULER_WIDTH_MS = 30_000; // show 30 seconds of ruler

type Props = {
  arrangement: Arrangement;
  recordings: Recording[];
  isPlaying: boolean;
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
};

function ClipBlock({ clip, recordings }: { clip: ClipInstance; recordings: Recording[] }) {
  const rec = recordings.find((r) => r.id === clip.recordingId);
  const widthPx = rec ? Math.max(4, msToPx(rec.durationMs, PX_PER_MS)) : 4;
  const leftPx = msToPx(clip.startMs, PX_PER_MS);

  return (
    <div
      className="timeline-clip"
      style={{ left: leftPx, width: widthPx }}
      title={rec?.name ?? clip.recordingId}
    >
      <span className="timeline-clip-label">{rec?.name ?? clip.recordingId}</span>
    </div>
  );
}

function TrackLane({
  trackId,
  clips,
  recordings,
  onDrop,
}: {
  trackId: string;
  clips: ClipInstance[];
  recordings: Recording[];
  onDrop: (trackId: string, recordingId: string, startMs: number) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // dropEffect may not be settable in jsdom; guard defensively.
    try { e.dataTransfer.dropEffect = "copy"; } catch { /* jsdom */ }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData("text/plain");
    if (!payload.startsWith("clip:")) return;
    const recordingId = payload.slice("clip:".length);
    const rect = laneRef.current?.getBoundingClientRect();
    const offsetPx = rect ? e.clientX - rect.left : 0;
    const startMs = snapMs(pxToMs(Math.max(0, offsetPx), PX_PER_MS), SNAP_MS);
    onDrop(trackId, recordingId, startMs);
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
        <ClipBlock key={clip.id} clip={clip} recordings={recordings} />
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

export default function Timeline({ arrangement, recordings, isPlaying, onPlaceClip }: Props) {
  return (
    <div className="timeline" role="region" aria-label="Timeline">
      <Ruler />
      <div className="timeline-tracks">
        {arrangement.tracks.map((track) => (
          <div key={track.id} className="timeline-track-row">
            <div className="timeline-track-label" style={{ background: track.color }}>
              {track.name}
            </div>
            <TrackLane
              trackId={track.id}
              clips={track.clips}
              recordings={recordings}
              onDrop={onPlaceClip}
            />
          </div>
        ))}
      </div>
      {/* Static playhead — becomes animated in Slice 7 */}
      <div
        className={`timeline-playhead${isPlaying ? " playing" : ""}`}
        aria-hidden="true"
      />
    </div>
  );
}
