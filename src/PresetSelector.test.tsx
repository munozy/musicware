import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresetSelector from "./PresetSelector";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";

describe("PresetSelector (STORY-K4)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  const lastCall = () => {
    const calls = vi.mocked(invoke).mock.calls;
    return calls[calls.length - 1];
  };

  it("dispatches set_preset with the right index for each preset", () => {
    render(<PresetSelector />);

    fireEvent.click(screen.getByRole("button", { name: "Organ" }));
    expect(lastCall()).toEqual(["set_preset", { index: 1 }]);

    fireEvent.click(screen.getByRole("button", { name: "Piano" }));
    expect(lastCall()).toEqual(["set_preset", { index: 2 }]);

    fireEvent.click(screen.getByRole("button", { name: "Sine" }));
    expect(lastCall()).toEqual(["set_preset", { index: 0 }]);
  });

  it("marks the clicked preset as the active selection", () => {
    render(<PresetSelector />);
    const organ = screen.getByRole("button", { name: "Organ" });
    const sine = screen.getByRole("button", { name: "Sine" });

    // Sine is the default active selection.
    expect(sine.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(organ);
    expect(organ.getAttribute("aria-pressed")).toBe("true");
    expect(sine.getAttribute("aria-pressed")).toBe("false");
  });
});
