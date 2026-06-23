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

  it("renders a 25-key, two-octave surface (15 white + 10 black) spanning C3–C5", () => {
    render(<App />);
    expect(screen.getAllByRole("button")).toHaveLength(25);
    // Range endpoints exist: C3 (note 48) and C5 (note 72).
    expect(screen.getByRole("button", { name: /note 48/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /note 72/ })).toBeDefined();
  });
});

describe("computer keyboard (STORY-K5 mapping)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("maps a physical key to its note on keydown and releases it on keyup", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" }); // A → C at the default octave (C4 = 60)
    fireEvent.keyUp(window, { key: "a" });

    const ons = callsFor("note_on");
    const offs = callsFor("note_off");
    expect(ons).toHaveLength(1);
    expect(ons[0][1]).toEqual({ note: 60 });
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 60 });
  });

  it("suppresses OS auto-repeat (a held key fires one note_on)", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "a", repeat: true }); // auto-repeat
    fireEvent.keyDown(window, { key: "a", repeat: true });

    expect(callsFor("note_on")).toHaveLength(1);
  });

  it("plays a held chord — multiple keys sound at once", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" }); // C4 = 60
    fireEvent.keyDown(window, { key: "d" }); // E4 = 64
    fireEvent.keyDown(window, { key: "g" }); // G4 = 67

    const notes = callsFor("note_on").map(([, arg]) => (arg as { note: number }).note);
    expect(notes).toEqual([60, 64, 67]);
  });

  it("octave shift (X) transposes subsequent notes up an octave", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "x" }); // octave up → base C5 (72)
    fireEvent.keyDown(window, { key: "a" });

    expect(callsFor("note_on")[0][1]).toEqual({ note: 72 });
  });

  it("releases the originally-pressed note even if the octave shifts while held", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" }); // note 60
    fireEvent.keyDown(window, { key: "x" }); // octave up while 'a' is still held
    fireEvent.keyUp(window, { key: "a" });

    const offs = callsFor("note_off");
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 60 }); // not 72 — no stranded note
  });
});
