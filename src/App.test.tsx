import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { saveRecordings } from "./recordings";

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

  it("glissando: with the button held, sliding onto a key plays it; releasing it stops it", () => {
    render(<App />);
    const c = screen.getByRole("button", { name: /note 60/ });
    const d = screen.getByRole("button", { name: /note 62/ });

    fireEvent.pointerDown(c); // press & hold C
    fireEvent.pointerLeave(c); // slide off C → C releases (the real browser sequence)
    fireEvent.pointerEnter(d, { buttons: 1 }); // slide onto D with the button held → plays
    const ons = callsFor("note_on").map(([, a]) => a);
    expect(ons).toContainEqual({ note: 60 });
    expect(ons).toContainEqual({ note: 62 });
    // The origin note goes silent as the cursor slides away (defining glissando trait).
    expect(callsFor("note_off").map(([, a]) => a)).toContainEqual({ note: 60 });

    fireEvent.pointerLeave(d); // slide off D → releases D
    expect(callsFor("note_off").map(([, a]) => a)).toContainEqual({ note: 62 });
  });

  it("hovering a key without a button held does NOT play it", () => {
    render(<App />);
    const d = screen.getByRole("button", { name: /note 62/ });
    fireEvent.pointerEnter(d, { buttons: 0 });
    expect(callsFor("note_on")).toHaveLength(0);
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

  it("renders a 61-key, five-octave surface (36 white + 25 black) spanning C1–C6", () => {
    render(<App />);
    // Count only keyboard keys (their labels contain "note N"), not the preset buttons.
    expect(screen.getAllByRole("button", { name: /note \d/ })).toHaveLength(61);
    // Range endpoints exist: C1 (note 24) and C6 (note 84).
    expect(screen.getByRole("button", { name: /note 24/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /note 84/ })).toBeDefined();
  });
});

describe("computer keyboard (STORY-K5 mapping)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("maps a physical key to its note on keydown and releases it on keyup", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" }); // A → C at the default octave (C3 = 48)
    fireEvent.keyUp(window, { key: "a" });

    const ons = callsFor("note_on");
    const offs = callsFor("note_off");
    expect(ons).toHaveLength(1);
    expect(ons[0][1]).toEqual({ note: 48 });
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 48 });
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
    fireEvent.keyDown(window, { key: "a" }); // C3 = 48
    fireEvent.keyDown(window, { key: "d" }); // E3 = 52
    fireEvent.keyDown(window, { key: "g" }); // G3 = 55

    const notes = callsFor("note_on").map(([, arg]) => (arg as { note: number }).note);
    expect(notes).toEqual([48, 52, 55]);
  });

  it("octave shift X/Z transposes from the C3 default up to C4 and down to C2", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "x" }); // C3 → C4 (base 60)
    fireEvent.keyDown(window, { key: "a" });
    expect(callsFor("note_on")[0][1]).toEqual({ note: 60 });

    vi.mocked(invoke).mockClear();
    fireEvent.keyDown(window, { key: "z" }); // C4 → C3
    fireEvent.keyDown(window, { key: "z" }); // C3 → C2 (base 36)
    fireEvent.keyDown(window, { key: "s" }); // D at C2 = 38
    expect(callsFor("note_on")[0][1]).toEqual({ note: 38 });
  });

  it("clamps the octave at the C1 floor and C5 ceiling", () => {
    render(<App />);
    // Down past C1 (default C3 → C2 → C1 → clamp).
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "a" });
    expect(callsFor("note_on")[0][1]).toEqual({ note: 24 }); // C1

    vi.mocked(invoke).mockClear();
    // Up past C5 (→ clamp at base 72, top key 'k' = 84 = C6).
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "k" });
    expect(callsFor("note_on")[0][1]).toEqual({ note: 84 }); // C6
  });

  it("releases the originally-pressed note even if the octave shifts while held", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "a" }); // note 48 (default C3)
    fireEvent.keyDown(window, { key: "z" }); // octave down while 'a' is still held
    fireEvent.keyUp(window, { key: "a" });

    const offs = callsFor("note_off");
    expect(offs).toHaveLength(1);
    expect(offs[0][1]).toEqual({ note: 48 }); // not 36 — no stranded note
  });
});

describe("keyboard highlights replay in sync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("lights a key when replay sounds it and clears it when the note ends", () => {
    vi.useFakeTimers();
    saveRecordings([
      {
        id: "r1",
        name: "Composition 1",
        createdAt: 0,
        durationMs: 500,
        events: [
          { t: 0, kind: "preset", index: 0 },
          { t: 0, kind: "on", note: 60 },
          { t: 300, kind: "off", note: 60 },
        ],
      },
    ]);
    render(<App />);
    const keyC = screen.getByRole("button", { name: /note 60/ });
    expect(keyC.className).not.toContain("held");

    fireEvent.click(screen.getByLabelText("Play Composition 1"));
    act(() => vi.advanceTimersByTime(10)); // fire the t=0 note_on
    expect(keyC.className).toContain("held");

    act(() => vi.advanceTimersByTime(350)); // fire the t=300 note_off
    expect(keyC.className).not.toContain("held");
  });
});

// Recorder UI now lives in the Transport (top bar) + Library (sidebar) wired to
// App's single useRecorder — so these are exercised at the App level.
describe("recorder UI (Transport + Library)", () => {
  const seed = (over = {}) => ({
    id: "r1",
    name: "Composition 1",
    createdAt: 0,
    durationMs: 3000,
    events: [
      { t: 0, kind: "preset" as const, index: 0 },
      { t: 0, kind: "on" as const, note: 60 },
      { t: 1000, kind: "off" as const, note: 60 },
    ],
    ...over,
  });

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("shows the empty state when there are no takes", () => {
    render(<App />);
    expect(screen.getByText(/No takes yet/i)).toBeDefined();
  });

  it("toggles the record button between Record and Stop recording", () => {
    render(<App />);
    const rec = screen.getByLabelText("Record");
    expect(rec.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(rec);
    expect(screen.getByLabelText("Stop recording").getAttribute("aria-pressed")).toBe("true");
  });

  it("lists a saved take in the sidebar with duration and controls", () => {
    saveRecordings([seed()]);
    render(<App />);
    expect(screen.getByLabelText("Play Composition 1")).toBeDefined();
    expect(screen.getByLabelText("Delete Composition 1")).toBeDefined();
    expect(screen.getByText("0:03")).toBeDefined();
  });

  it("renames a take inline", () => {
    saveRecordings([seed()]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("Rename Composition 1"));
    const input = screen.getByLabelText("New name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Intro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Intro")).toBeDefined();
  });

  it("shows an undo toast after delete and restores on Undo", () => {
    saveRecordings([seed()]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(screen.queryByLabelText("Play Composition 1")).toBeNull();
    expect(screen.getByText(/Deleted/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Undo delete/ }));
    expect(screen.getByLabelText("Play Composition 1")).toBeDefined();
    expect(screen.queryByText(/Deleted/)).toBeNull();
  });

  it("auto-dismisses the undo toast, keeping the take deleted", () => {
    vi.useFakeTimers();
    saveRecordings([seed()]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(screen.getByText(/Deleted/)).toBeDefined();
    act(() => vi.advanceTimersByTime(5001));
    expect(screen.queryByText(/Deleted/)).toBeNull();
    expect(screen.queryByLabelText("Play Composition 1")).toBeNull();
  });

  it("restores focus: to Undo after delete, to the name button after rename", () => {
    saveRecordings([seed()]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("Rename Composition 1"));
    act(() => {
      fireEvent.keyDown(screen.getByLabelText("New name"), { key: "Enter" });
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Rename Composition 1"));

    fireEvent.click(screen.getByLabelText("Delete Composition 1"));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Undo delete/ }));
  });
});

describe("record shortcut (R)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("toggles record/stop on R", () => {
    render(<App />);
    expect(screen.getByLabelText("Record")).toBeDefined();

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByLabelText("Stop recording")).toBeDefined();

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByLabelText("Record")).toBeDefined();
  });

  it("ignores R while typing in a field (so rename can contain 'r')", () => {
    saveRecordings([
      { id: "r1", name: "Composition 1", createdAt: 0, durationMs: 1000, events: [] },
    ]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("Rename Composition 1"));
    const input = screen.getByLabelText("New name") as HTMLInputElement;
    input.focus();

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.queryByLabelText("Stop recording")).toBeNull(); // did NOT start recording
  });
});
