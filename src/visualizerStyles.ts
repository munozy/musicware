// The selectable visualizer styles. Shared by the picker and the canvas renderer.
export const VIZ_STYLES = [
  { id: "scope", label: "Scope" },
  { id: "bars", label: "Bars" },
  { id: "radial", label: "Radial" },
] as const;

export type VizStyle = (typeof VIZ_STYLES)[number]["id"];

export const DEFAULT_VIZ: VizStyle = "scope";

export function isVizStyle(v: unknown): v is VizStyle {
  return typeof v === "string" && VIZ_STYLES.some((s) => s.id === v);
}
