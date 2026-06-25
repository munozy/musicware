import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import ChordDisplay from "./ChordDisplay";
import * as synth from "./synth";

describe("ChordDisplay", () => {
  beforeEach(() => {
    synth.emit({ kind: "preset", index: 0 }); // reset to a tonal preset
  });

  it("names the chord for a tonal preset", () => {
    render(<ChordDisplay />);
    act(() => {
      synth.emit({ kind: "on", note: 60 });
      synth.emit({ kind: "on", note: 64 });
      synth.emit({ kind: "on", note: 67 });
    });
    expect(screen.getByText("C")).toBeDefined();
    expect(screen.getByText("major")).toBeDefined();
  });

  it("shows DRUM names (not pitches) when the Drums preset is active — DEBT-023", () => {
    render(<ChordDisplay />);
    act(() => synth.emit({ kind: "preset", index: 4 })); // Drums
    act(() => {
      synth.emit({ kind: "on", note: 60 }); // C → Kick
      synth.emit({ kind: "on", note: 62 }); // D → Snare
    });
    expect(screen.getByText("Kick · Snare")).toBeDefined();
    expect(screen.getByText("drum kit")).toBeDefined();
    expect(screen.queryByText("C")).toBeNull(); // no pitch/chord lie
    expect(screen.queryByText("major")).toBeNull();
  });
});
