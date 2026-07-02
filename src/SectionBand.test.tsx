import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SectionBand, { type SectionOps } from "./SectionBand";
import type { Section } from "./arrangement";

const sections: Section[] = [
  { id: "s1", name: "Intro", startMs: 0, endMs: 4000, color: "#4f86f7" },
  { id: "s2", name: "Drop", startMs: 4000, endMs: 10000, color: "#e06a8b" },
];

const ops = (): SectionOps => ({
  onAddSection: vi.fn(),
  onRenameSection: vi.fn(),
  onMoveSection: vi.fn(),
  onResizeSection: vi.fn(),
  onRemoveSection: vi.fn(),
  onApplyTemplate: vi.fn(),
  onSuggestSection: vi.fn(),
});

describe("SectionBand", () => {
  let o: SectionOps;
  beforeEach(() => {
    o = ops();
  });

  it("renders the empty hint when there are no sections", () => {
    render(<SectionBand sections={[]} contentMs={0} ops={o} />);
    expect(screen.getByText(/no structure yet/i)).toBeDefined();
  });

  it("renders each section by name", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    expect(screen.getByText("Intro")).toBeDefined();
    expect(screen.getByText("Drop")).toBeDefined();
  });

  it("'+ Section' adds after the last section's end", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    expect(o.onAddSection).toHaveBeenCalledWith(10000, 14000); // last end 10000 + default 4000
  });

  it("picking a template applies it across the content span", () => {
    render(<SectionBand sections={[]} contentMs={20000} ops={o} />);
    fireEvent.change(screen.getByRole("combobox", { name: /structure template/i }), {
      target: { value: "rock" },
    });
    expect(o.onApplyTemplate).toHaveBeenCalledWith("rock", 20000);
  });

  it("a template with no content yet uses the default span", () => {
    render(<SectionBand sections={[]} contentMs={0} ops={o} />);
    fireEvent.change(screen.getByRole("combobox", { name: /structure template/i }), {
      target: { value: "electronic" },
    });
    expect(o.onApplyTemplate).toHaveBeenCalledWith("electronic", 30000);
  });

  it("renames a section via click-to-edit + Enter, and deletes via ×", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.change(input, { target: { value: "Verse" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(o.onRenameSection).toHaveBeenCalledWith("s1", "Verse");

    fireEvent.click(screen.getByRole("button", { name: /remove section drop/i }));
    expect(o.onRemoveSection).toHaveBeenCalledWith("s2");
  });

  it("the ✨ button asks for suggestions for that section", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByRole("button", { name: /suggest clips for intro/i }));
    expect(o.onSuggestSection).toHaveBeenCalledWith(sections[0]);
  });

  it("sections are keyboard-operable: arrows move, Shift+arrows resize (DEBT-034)", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    const block = screen.getByRole("group", { name: /intro section/i });
    expect(block.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(block, { key: "ArrowRight" });
    expect(o.onMoveSection).toHaveBeenCalledWith("s1", 500);
    fireEvent.keyDown(block, { key: "ArrowLeft" });
    expect(o.onMoveSection).toHaveBeenCalledWith("s1", 0); // clamped at the origin

    fireEvent.keyDown(block, { key: "ArrowRight", shiftKey: true });
    expect(o.onResizeSection).toHaveBeenCalledWith("s1", 4500);
    fireEvent.keyDown(block, { key: "ArrowLeft", shiftKey: true });
    expect(o.onResizeSection).toHaveBeenCalledWith("s1", 3500);
  });

  it("typing in the rename input never moves the section (keys don't leak to the block)", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.keyDown(input, { key: "ArrowLeft" }); // caret movement, not a section move
    expect(o.onMoveSection).not.toHaveBeenCalled();
  });

  it("modified arrow chords (Cmd/Ctrl/Alt) are not hijacked as section moves", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    const block = screen.getByRole("group", { name: /intro section/i });
    fireEvent.keyDown(block, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(block, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(block, { key: "ArrowRight", altKey: true });
    expect(o.onMoveSection).not.toHaveBeenCalled();
    expect(o.onResizeSection).not.toHaveBeenCalled();
  });

  it("focus returns to the section block after a rename commits (keyboard path not stranded)", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.change(input, { target: { value: "Verse" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("group", { name: /intro section/i }));
  });

  it("Enter commits the rename exactly ONCE (the refocus blur must not re-commit)", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.change(input, { target: { value: "Verse" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // the blur the refocus triggers — must be a guarded no-op
    expect(o.onRenameSection).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels the rename AND returns focus to the block", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(o.onRenameSection).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("group", { name: /intro section/i }));
  });

  it("a mouse blur commits but does NOT steal focus back to the block", () => {
    render(<SectionBand sections={sections} contentMs={10000} ops={o} />);
    fireEvent.click(screen.getByText("Intro"));
    const input = screen.getByRole("textbox", { name: /rename intro/i });
    fireEvent.change(input, { target: { value: "Verse" } });
    fireEvent.blur(input); // e.g. the user clicked another control
    expect(o.onRenameSection).toHaveBeenCalledWith("s1", "Verse");
    expect(document.activeElement).not.toBe(screen.getByRole("group", { name: /intro section/i }));
  });
});
