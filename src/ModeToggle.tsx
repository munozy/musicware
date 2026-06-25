/**
 * [ Play | Song ] mode-toggle pill for the top bar (DESIGN-002 §1).
 * Blocks the switch to Song while recording; keyboard: Left/Right arrows move within the group.
 */

export type AppMode = "play" | "song";

type Props = {
  mode: AppMode;
  onChange: (m: AppMode) => void;
  isRecording: boolean;
};

export default function ModeToggle({ mode, onChange, isRecording }: Props) {
  const songDisabled = isRecording;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { onChange("play"); e.preventDefault(); }
    if (e.key === "ArrowRight" && !songDisabled) { onChange("song"); e.preventDefault(); }
  };

  return (
    <div
      role="group"
      aria-label="View mode"
      className="mode-toggle"
      onKeyDown={onKeyDown}
    >
      <button
        className={`mode-toggle-btn${mode === "play" ? " selected" : ""}`}
        aria-pressed={mode === "play"}
        onClick={() => onChange("play")}
      >
        Play
      </button>
      <button
        className={`mode-toggle-btn${mode === "song" ? " selected" : ""}`}
        aria-pressed={mode === "song"}
        onClick={() => !songDisabled && onChange("song")}
        disabled={songDisabled}
        title={songDisabled ? "Stop recording first" : undefined}
      >
        Song
      </button>
    </div>
  );
}
