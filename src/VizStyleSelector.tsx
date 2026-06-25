import { VIZ_STYLES, type VizStyle } from "./visualizerStyles";

/** Segmented control to pick the visualizer style. */
function VizStyleSelector({
  value,
  onChange,
}: {
  value: VizStyle;
  onChange: (s: VizStyle) => void;
}) {
  return (
    <div className="viz-style" role="group" aria-label="Visualizer style">
      {VIZ_STYLES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`viz-style-btn${value === id ? " selected" : ""}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default VizStyleSelector;
