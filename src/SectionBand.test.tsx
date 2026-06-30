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
});
