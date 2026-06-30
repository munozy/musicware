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

import { useRef, useState } from "react";
import { arrangementContentMs, clipPlayedMs, clipWindow, type Arrangement, type ClipInstance } from "./arrangement";
import { isVoice, VOICE_EFFECTS, type Recording, type VoiceEffect } from "./recordings";
import { pxToMs, msToPx, snapMs, beatMs, PX_PER_MS } from "./timeScale";
import TrackHeader from "./TrackHeader";
import SectionBand, { type SectionOps } from "./SectionBand";
import Playhead from "./Playhead";

const SNAP_MS = 100; // fallback keyboard-nudge step when snapping is off
const RULER_WIDTH_MS = 30_000; // show 30 seconds of ruler
const MIN_CLIP_PX = 4;

/** "+2" / "-3" / "0" — the semitone offset for a transpose badge. */
const fmtTranspose = (t: number): string => (t > 0 ? `+${t}` : `${t}`);

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
  gridMs: number; // snap step from the transport (0 = free placement)
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
  clipOps: ClipOps;
  trackOps: TrackOps;
  sectionOps: SectionOps;
  selection: Selection;
};

type ClipOps = {
  onMoveClip: (clipId: string, startMs: number) => void;
  onRemoveClip: (clipId: string) => void;
  onToggleClipMute: (clipId: string) => void;
  onDuplicateClip: (clipId: string, atMs: number) => void;
  onSetClipLoop: (clipId: string, count: number) => void;
  onTransposeClip: (clipId: string, semitones: number) => void;
  onTrimClip: (clipId: string, patch: { startMs?: number; trimStartMs?: number; trimEndMs?: number }) => void;
  onSetClipEffect: (clipId: string, effect: VoiceEffect) => void;
};

const MIN_WINDOW_MS = 100; // a trimmed brick can't be shorter than one snap step

export type Selection = {
  selectedIds: Set<string>;
  onSelectClip: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
};

function ClipBlock({
  clip,
  recordings,
  onMoveClip,
  onRemoveClip,
  onToggleClipMute,
  onDuplicateClip,
  onSetClipLoop,
  onTransposeClip,
  onTrimClip,
  onSetClipEffect,
  gridMs,
  selected,
  onSelectClip,
}: {
  clip: ClipInstance;
  recordings: Recording[];
  gridMs: number;
  selected: boolean;
  onSelectClip: (id: string, additive: boolean) => void;
} & ClipOps) {
  const nudgeMs = gridMs > 0 ? gridMs : SNAP_MS; // keyboard ←/→ step (a grid step, or 100ms when snap off)
  const rec = recordings.find((r) => r.id === clip.recordingId);
  const name = rec?.name ?? clip.recordingId;
  const loops = Math.max(1, Math.floor(clip.loopCount || 1));
  const transpose = Math.trunc(clip.transpose || 0);
  // Voice clips edit their EFFECT (transpose is a no-op for audio); keyboard clips transpose.
  const voice = !!rec && isVoice(rec);
  const effect: VoiceEffect = clip.effect ?? rec?.audio?.effect ?? "none";
  const effectLabel = VOICE_EFFECTS.find((e) => e.value === effect)?.label ?? "";
  const effectEmoji = effectLabel.split(" ")[0];
  // Width reflects the TRIMMED window × loops, so the block on screen is exactly as long as
  // it sounds (clipPlayedMs is the same maths the scheduler loops over). Falls back to a stub
  // width for a dangling clip whose recording is gone.
  const playedMs = rec ? clipPlayedMs(clip, rec.durationMs) : 0;
  const widthPx = rec ? Math.max(MIN_CLIP_PX, msToPx(playedMs, PX_PER_MS)) : MIN_CLIP_PX;
  const leftPx = msToPx(clip.startMs, PX_PER_MS);
  // Duplicate lands right after this clip so the copy abuts (the caller owns the geometry —
  // the store stays recording-agnostic per ADR-0007).
  const dupAtMs = clip.startMs + (rec ? playedMs : SNAP_MS);

  const clipElRef = useRef<HTMLDivElement>(null);
  const [trimming, setTrimming] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    const grabOffsetPx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    e.dataTransfer.setData("text/plain", `move:${clip.id}:${Math.max(0, grabOffsetPx)}`);
    e.dataTransfer.effectAllowed = "move";
  };

  // Drag a clip edge to trim. Right edge sets trimEndMs; left edge sets trimStartMs AND shifts
  // startMs so the kept audio stays put (standard DAW behaviour). The recording's real length
  // bounds it here (the store stays duration-agnostic). While trimming we disable the clip's
  // HTML5 move-drag (state + an imperative guard for the gap before the re-render lands).
  const beginTrim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    if (!rec) return;
    e.preventDefault();
    e.stopPropagation();
    clipElRef.current?.setAttribute("draggable", "false");
    setTrimming(true);
    const startX = e.clientX;
    const { ws: origWs, we: origWe } = clipWindow(clip, rec.durationMs);
    const origStartMs = clip.startMs;
    const onMove = (ev: PointerEvent) => {
      const deltaMs = pxToMs(ev.clientX - startX, PX_PER_MS);
      if (edge === "end") {
        const newWe = Math.min(rec.durationMs, Math.max(origWs + MIN_WINDOW_MS, snapMs(origWe + deltaMs, gridMs)));
        onTrimClip(clip.id, { trimEndMs: newWe });
      } else {
        const newWs = Math.max(0, Math.min(origWe - MIN_WINDOW_MS, snapMs(origWs + deltaMs, gridMs)));
        onTrimClip(clip.id, { trimStartMs: newWs, startMs: Math.max(0, origStartMs + (newWs - origWs)) });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setTrimming(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMoveClip(clip.id, clip.startMs - nudgeMs); // store clamps >= 0
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onMoveClip(clip.id, clip.startMs + nudgeMs);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onTransposeClip(clip.id, transpose + 1); // store clamps to ±MAX_TRANSPOSE
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onTransposeClip(clip.id, transpose - 1);
    } else if (e.key === "]") {
      e.preventDefault();
      onSetClipLoop(clip.id, loops + 1);
    } else if (e.key === "[") {
      e.preventDefault();
      onSetClipLoop(clip.id, loops - 1); // store clamps >= 1
    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      onDuplicateClip(clip.id, dupAtMs);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemoveClip(clip.id);
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      onToggleClipMute(clip.id);
    }
  };

  // Shared by every in-clip button: don't let the press start a clip drag or bubble to the lane.
  const btnGuard = {
    draggable: false as const,
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return (
    <div
      ref={clipElRef}
      data-clip-id={clip.id}
      className={`timeline-clip${clip.muted ? " muted" : ""}${trimming ? " trimming" : ""}${selected ? " selected" : ""}`}
      style={{ left: leftPx, width: widthPx }}
      title={`${name} — click to select (Shift/⌘ adds) · drag to move · drag edges to trim · D duplicate · ↑↓ transpose · [ ] loop · M mute · Del remove`}
      onClick={(e) => onSelectClip(clip.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      draggable={!trimming}
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${name} clip at ${(clip.startMs / 1000).toFixed(1)} seconds${loops > 1 ? `, looped ${loops} times` : ""}${transpose !== 0 ? `, transposed ${fmtTranspose(transpose)} semitones` : ""}${clip.muted ? ", muted" : ""}. Drag or Left/Right to move; Up/Down to transpose; [ and ] to loop; D to duplicate; M to mute; Delete to remove. Drag the left/right edges to trim.`}
    >
      <span
        className="timeline-clip-trim timeline-clip-trim-start"
        aria-hidden="true"
        onPointerDown={beginTrim("start")}
        onDragStart={(e) => e.preventDefault()}
      />
      <span
        className="timeline-clip-trim timeline-clip-trim-end"
        aria-hidden="true"
        onPointerDown={beginTrim("end")}
        onDragStart={(e) => e.preventDefault()}
      />

      <span className="timeline-clip-label">{name}</span>

      {(loops > 1 || (voice ? effect !== "none" : transpose !== 0)) && (
        <span className="timeline-clip-badges" aria-hidden="true">
          {loops > 1 && <span className="clip-badge clip-badge-loop">×{loops}</span>}
          {voice
            ? effect !== "none" && <span className="clip-badge clip-badge-effect">{effectEmoji}</span>
            : transpose !== 0 && <span className="clip-badge clip-badge-transpose">{fmtTranspose(transpose)}</span>}
        </span>
      )}

      <button
        className="timeline-clip-dup"
        aria-label={`Duplicate ${name} clip`}
        title="Duplicate"
        {...btnGuard}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicateClip(clip.id, dupAtMs);
        }}
      >
        ⧉
      </button>
      <button
        className={`timeline-clip-mute${clip.muted ? " active" : ""}`}
        aria-label={`${clip.muted ? "Unmute" : "Mute"} ${name} clip`}
        aria-pressed={clip.muted ?? false}
        title={clip.muted ? "Unmute" : "Mute"}
        {...btnGuard}
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
        {...btnGuard}
        onClick={(e) => {
          e.stopPropagation();
          onRemoveClip(clip.id);
        }}
      >
        ×
      </button>

      <div className="timeline-clip-edit">
        <span className="clip-stepper" role="group" aria-label={`Loop ${name} clip`}>
          <button
            className="clip-stepper-btn"
            aria-label="Loop fewer times"
            title="Loop fewer"
            {...btnGuard}
            onClick={(e) => {
              e.stopPropagation();
              onSetClipLoop(clip.id, loops - 1);
            }}
          >
            −
          </button>
          <span className="clip-stepper-val">×{loops}</span>
          <button
            className="clip-stepper-btn"
            aria-label="Loop more times"
            title="Loop more"
            {...btnGuard}
            onClick={(e) => {
              e.stopPropagation();
              onSetClipLoop(clip.id, loops + 1);
            }}
          >
            +
          </button>
        </span>
        {voice ? (
          <select
            className="clip-effect-select"
            value={effect}
            aria-label={`Effect for ${name} clip`}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              onSetClipEffect(clip.id, e.target.value as VoiceEffect);
            }}
          >
            {VOICE_EFFECTS.map((eff) => (
              <option key={eff.value} value={eff.value}>
                {eff.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="clip-stepper" role="group" aria-label={`Transpose ${name} clip`}>
            <button
              className="clip-stepper-btn"
              aria-label="Transpose down a semitone"
              title="Transpose down"
              {...btnGuard}
              onClick={(e) => {
                e.stopPropagation();
                onTransposeClip(clip.id, transpose - 1);
              }}
            >
              −
            </button>
            <span className="clip-stepper-val">{fmtTranspose(transpose)}</span>
            <button
              className="clip-stepper-btn"
              aria-label="Transpose up a semitone"
              title="Transpose up"
              {...btnGuard}
              onClick={(e) => {
                e.stopPropagation();
                onTransposeClip(clip.id, transpose + 1);
              }}
            >
              +
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function TrackLane({
  trackId,
  clips,
  recordings,
  gridMs,
  onPlaceClip,
  clipOps,
  selection,
}: {
  trackId: string;
  clips: ClipInstance[];
  recordings: Recording[];
  gridMs: number;
  onPlaceClip: (trackId: string, recordingId: string, startMs: number) => void;
  clipOps: ClipOps;
  selection: Selection;
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
      onPlaceClip(trackId, recordingId, snapMs(pxToMs(offsetPx, PX_PER_MS), gridMs));
    } else if (payload.startsWith("move:")) {
      const rest = payload.slice("move:".length);
      const sep = rest.lastIndexOf(":");
      const clipId = sep >= 0 ? rest.slice(0, sep) : rest;
      const grabOffsetPx = sep >= 0 ? Number(rest.slice(sep + 1)) || 0 : 0;
      const leftPx = Math.min(Math.max(0, e.clientX - laneLeft - grabOffsetPx), laneWidth);
      clipOps.onMoveClip(clipId, snapMs(pxToMs(leftPx, PX_PER_MS), gridMs));
    }
  };

  return (
    <div
      ref={laneRef}
      className="timeline-lane"
      data-testid={`lane-${trackId}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) selection.onClearSelection(); // click empty lane → clear
      }}
    >
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          recordings={recordings}
          gridMs={gridMs}
          selected={selection.selectedIds.has(clip.id)}
          onSelectClip={selection.onSelectClip}
          {...clipOps}
        />
      ))}
    </div>
  );
}

function Ruler({ bpm, beatsPerBar }: { bpm: number; beatsPerBar: number }) {
  const beat = beatMs(bpm);
  const totalBeats = Math.floor(RULER_WIDTH_MS / beat);
  const ticks = [];
  for (let b = 0; b <= totalBeats; b++) {
    const px = msToPx(b * beat, PX_PER_MS);
    const isBar = b % beatsPerBar === 0;
    ticks.push(
      <div key={b} className={`ruler-tick${isBar ? " bar" : ""}`} style={{ left: px }}>
        {isBar && <span className="ruler-label">{Math.floor(b / beatsPerBar) + 1}</span>}
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
  gridMs,
  onPlaceClip,
  clipOps,
  trackOps,
  sectionOps,
  selection,
}: Props) {
  return (
    <div className="timeline" role="region" aria-label="Timeline">
      <Ruler bpm={arrangement.tempoBpm} beatsPerBar={arrangement.timeSig?.[0] ?? 4} />
      <SectionBand
        sections={arrangement.sections}
        contentMs={arrangementContentMs(arrangement, recordings)}
        ops={sectionOps}
      />
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
              gridMs={gridMs}
              onPlaceClip={onPlaceClip}
              clipOps={clipOps}
              selection={selection}
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
