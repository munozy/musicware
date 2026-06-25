import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import VizStyleSelector from "./VizStyleSelector";
import { useVisualizerStyle } from "./useVisualizerStyle";

describe("VizStyleSelector", () => {
  it("renders a button per style and marks the active one", () => {
    render(<VizStyleSelector value="scope" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Scope" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Bars" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Radial" })).toBeDefined();
  });

  it("calls onChange with the chosen style id", () => {
    const onChange = vi.fn();
    render(<VizStyleSelector value="scope" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Bars" }));
    expect(onChange).toHaveBeenCalledWith("bars");
  });
});

describe("useVisualizerStyle", () => {
  it("defaults to scope and persists the choice", () => {
    localStorage.clear();
    const { result } = renderHook(() => useVisualizerStyle());
    expect(result.current[0]).toBe("scope");

    act(() => result.current[1]("radial"));
    expect(result.current[0]).toBe("radial");
    expect(localStorage.getItem("musicware.viz.v1")).toBe("radial");

    // A fresh hook restores the persisted style.
    const again = renderHook(() => useVisualizerStyle());
    expect(again.result.current[0]).toBe("radial");
  });
});
