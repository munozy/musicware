import { useEffect, useState } from "react";
import { getCurrentPreset, setPreset, subscribePreset } from "./synth";

// Indices must match `PRESETS` in src-tauri/src/audio.rs.
const PRESETS = [
  { index: 0, label: "Sine" },
  { index: 1, label: "Organ" },
  { index: 2, label: "Piano" },
  { index: 3, label: "Bells" },
  { index: 4, label: "Drums" },
];

/**
 * Timbre selector (STORY-K4). A segmented control; clicking a preset sends the
 * `set_preset` Tauri command. Orthogonal to the keyboard — it never touches the
 * note_on/note_off path.
 */
function PresetSelector() {
  // Initialise from the engine's current preset (not a hard-coded 0) so the active
  // button is right on mount; then follow the broadcast for live clicks AND the
  // timbre a take switches to during replay.
  const [selected, setSelected] = useState(getCurrentPreset);
  useEffect(() => subscribePreset(setSelected), []);

  // setPreset emits → the broadcast updates `selected`, so we don't set it here.
  const choose = (index: number) => setPreset(index);

  return (
    <div className="presets" role="group" aria-label="Timbre preset">
      {PRESETS.map(({ index, label }) => (
        <button
          key={index}
          type="button"
          className={`preset${selected === index ? " selected" : ""}`}
          aria-pressed={selected === index}
          onClick={() => choose(index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default PresetSelector;
