import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";
import VolumeControl from "./VolumeControl";

const volumeCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === "set_volume")
    .map(([, arg]) => (arg as { level: number }).level);

const lastVolume = () => {
  const v = volumeCalls();
  return v[v.length - 1];
};

describe("VolumeControl", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
  });

  it("pushes the default level to the engine on mount", () => {
    render(<VolumeControl />);
    expect(lastVolume()).toBe(0.6);
  });

  it("raises the volume with the + button and dispatches set_volume", () => {
    render(<VolumeControl />);
    fireEvent.click(screen.getByLabelText("Raise volume"));
    expect(lastVolume()).toBeCloseTo(0.7, 5);
    expect(screen.getByText("70%")).toBeDefined();
  });

  it("lowers the volume with the − button", () => {
    render(<VolumeControl />);
    fireEvent.click(screen.getByLabelText("Lower volume"));
    expect(lastVolume()).toBeCloseTo(0.5, 5);
  });

  it("sets the level from the slider", () => {
    render(<VolumeControl />);
    fireEvent.change(screen.getByLabelText("Volume level"), { target: { value: "0.25" } });
    expect(lastVolume()).toBeCloseTo(0.25, 5);
    expect(screen.getByText("25%")).toBeDefined();
  });

  it("clamps at the ceiling and disables + at max", () => {
    render(<VolumeControl />);
    fireEvent.change(screen.getByLabelText("Volume level"), { target: { value: "1" } });
    const up = screen.getByLabelText("Raise volume") as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    fireEvent.click(up); // no-op
    expect(lastVolume()).toBe(1);
  });

  it("restores the persisted level on remount", () => {
    const { unmount } = render(<VolumeControl />);
    fireEvent.change(screen.getByLabelText("Volume level"), { target: { value: "0.33" } });
    unmount();

    vi.mocked(invoke).mockClear();
    render(<VolumeControl />);
    expect(lastVolume()).toBeCloseTo(0.33, 5);
    expect(screen.getByText("33%")).toBeDefined();
  });
});
