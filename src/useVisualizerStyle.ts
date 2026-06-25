import { useEffect, useState } from "react";
import { DEFAULT_VIZ, isVizStyle, type VizStyle } from "./visualizerStyles";

const STORAGE_KEY = "musicware.viz.v1";

function loadStyle(): VizStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isVizStyle(raw) ? raw : DEFAULT_VIZ;
  } catch {
    return DEFAULT_VIZ;
  }
}

/** Selected visualizer style, persisted across sessions. */
export function useVisualizerStyle(): [VizStyle, (s: VizStyle) => void] {
  const [style, setStyle] = useState<VizStyle>(loadStyle);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, style);
    } catch {
      /* ignore persistence failures */
    }
  }, [style]);
  return [style, setStyle];
}
