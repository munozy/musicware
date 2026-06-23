import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

// Mock the Tauri IPC boundary — assert the commands the keyboard dispatches,
// without a running backend.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
import { invoke } from "@tauri-apps/api/core";

const callsFor = (cmd: string) =>
  vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

describe("keyboard (STORY-K1)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("emits exactly one note_on on press and one note_off on release, with the correct note", () => {
    render(<App />);
    const middleC = screen.getByRole("button", { name: /note 60/ });

    fireEvent.pointerDown(middleC);
    fireEvent.pointerUp(middleC);

    const ons = callsFor("note_on");
    const offs = callsFor("note_off");
    expect(ons).toHaveLength(1);
    expect(ons[0][1]).toEqual({ note: 60 });
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 60 });
  });

  it("does not retrigger note_on while a key is held down", () => {
    render(<App />);
    const d = screen.getByRole("button", { name: /note 62/ });

    fireEvent.pointerDown(d);
    fireEvent.pointerDown(d); // duplicate down (e.g. auto-repeat) must be ignored

    expect(callsFor("note_on")).toHaveLength(1);
  });

  it("does not double-fire note_off when pointerleave and pointerup both occur", () => {
    render(<App />);
    const e = screen.getByRole("button", { name: /note 64/ });

    fireEvent.pointerDown(e);
    fireEvent.pointerLeave(e);
    fireEvent.pointerUp(e);

    expect(callsFor("note_off")).toHaveLength(1);
  });

  it("releases a held note when the window loses focus (no stuck note on alt-tab)", () => {
    render(<App />);
    const f = screen.getByRole("button", { name: /note 65/ });

    fireEvent.pointerDown(f);
    fireEvent.blur(window); // alt/cmd-tab away while still holding the key

    const offs = callsFor("note_off");
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 65 });
  });

  it("renders a full octave: 7 white keys and 5 black keys", () => {
    render(<App />);
    expect(screen.getAllByRole("button")).toHaveLength(12);
  });
});
