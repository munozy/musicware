import { useEffect, useState } from "react";
import { setPreset, subscribePreset } from "./synth";

// Indices must match `PRESETS` in src-tauri/src/audio.rs.
const PRESETS = [
  { index: 0, label: "Sine" },
  { index: 1, label: "Organ" },
  { index: 2, label: "Piano" },
  { index: 3, label: "Bells" },
];

/**
 * Timbre selector (STORY-K4). A segmented control; clicking a preset sends the
 * `set_preset` Tauri command. Orthogonal to the keyboard — it never touches the
 * note_on/note_off path.
 */
function PresetSelector() {
  const [selected, setSelected] = useState(0);

  // Follow the preset broadcast so the active button reflects what's actually
  // sounding — including the timbre a take switches to during replay.
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
