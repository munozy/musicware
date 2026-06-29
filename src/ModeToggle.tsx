/**
 * [ Play | Voice | Song ] mode-toggle pill for the top bar (DESIGN-002 §1, extended for
 * voice — ADR-0009). Blocks the switch to Song while a keyboard take is recording;
 * Left/Right arrows move within the group.
 */

export type AppMode = "play" | "voice" | "song" | "video";

const ORDER: AppMode[] = ["play", "voice", "song", "video"];
const LABEL: Record<AppMode, string> = { play: "Play", voice: "Voice", song: "Song", video: "Video" };

type Props = {
  mode: AppMode;
  onChange: (m: AppMode) => void;
  isRecording: boolean;
};

export default function ModeToggle({ mode, onChange, isRecording }: Props) {
  const songDisabled = isRecording; // can't arrange while a keyboard take is being captured

  const disabled = (m: AppMode) => m === "song" && songDisabled;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ORDER.indexOf(mode);
    if (e.key === "ArrowLeft" && i > 0) {
      onChange(ORDER[i - 1]);
      e.preventDefault();
    } else if (e.key === "ArrowRight" && i < ORDER.length - 1 && !disabled(ORDER[i + 1])) {
      onChange(ORDER[i + 1]);
      e.preventDefault();
    }
  };

  return (
    <div role="group" aria-label="View mode" className="mode-toggle" onKeyDown={onKeyDown}>
      {ORDER.map((m) => (
        <button
          key={m}
          className={`mode-toggle-btn${mode === m ? " selected" : ""}`}
          aria-pressed={mode === m}
          onClick={() => !disabled(m) && onChange(m)}
          disabled={disabled(m)}
          title={disabled(m) ? "Stop recording first" : undefined}
        >
          {LABEL[m]}
        </button>
      ))}
    </div>
  );
}
