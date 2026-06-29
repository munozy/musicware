import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SongBar from "./SongBar";

const songs = [
  { id: "s1", name: "Song 1" },
  { id: "s2", name: "Song 2" },
];

const baseProps = () => ({
  songs,
  activeSongId: "s1",
  onSelect: vi.fn(),
  onNew: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onExport: vi.fn(),
  exporting: false,
});

describe("SongBar", () => {
  let p: ReturnType<typeof baseProps>;
  beforeEach(() => {
    p = baseProps();
  });

  it("lists songs in a select and switches on change", () => {
    render(<SongBar {...p} />);
    const select = screen.getByRole("combobox", { name: /select song/i }) as HTMLSelectElement;
    expect(select.value).toBe("s1");
    fireEvent.change(select, { target: { value: "s2" } });
    expect(p.onSelect).toHaveBeenCalledWith("s2");
  });

  it("creates a new song", () => {
    render(<SongBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /new song/i }));
    expect(p.onNew).toHaveBeenCalledOnce();
  });

  it("renames the active song via the ✎ toggle + Enter", () => {
    render(<SongBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /rename song/i }));
    const input = screen.getByRole("textbox", { name: /song name/i });
    fireEvent.change(input, { target: { value: "Banger" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("s1", "Banger");
  });

  it("deletes only after a Yes confirm", () => {
    render(<SongBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete song$/i }));
    expect(p.onDelete).not.toHaveBeenCalled(); // confirm first
    fireEvent.click(screen.getByRole("button", { name: /confirm delete song/i }));
    expect(p.onDelete).toHaveBeenCalledWith("s1");
  });

  it("disables delete when only one song remains", () => {
    render(<SongBar {...p} songs={[{ id: "s1", name: "Song 1" }]} />);
    expect((screen.getByRole("button", { name: /delete song/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Export calls onExport with the chosen format (defaults to mp3; switch to wav)", () => {
    render(<SongBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /export song/i }));
    expect(p.onExport).toHaveBeenLastCalledWith("mp3"); // default

    fireEvent.change(screen.getByRole("combobox", { name: /export format/i }), { target: { value: "wav" } });
    fireEvent.click(screen.getByRole("button", { name: /export song/i }));
    expect(p.onExport).toHaveBeenLastCalledWith("wav");
  });

  it("shows 'Exporting…' and disables the controls while exporting", () => {
    render(<SongBar {...p} exporting={true} />);
    const btn = screen.getByRole("button", { name: /export song/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/exporting/i);
    expect((screen.getByRole("combobox", { name: /export format/i }) as HTMLSelectElement).disabled).toBe(true);
  });
});
