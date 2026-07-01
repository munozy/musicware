import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import StorageBanner from "./StorageBanner";
import { reportPersist, __resetPersistHealth } from "./persistHealth";

beforeEach(() => __resetPersistHealth());
afterEach(() => vi.restoreAllMocks());

describe("StorageBanner (DEBT-034)", () => {
  it("is hidden while persistence is healthy", () => {
    render(<StorageBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("appears when a persist fails and disappears when it recovers", () => {
    render(<StorageBanner />);
    act(() => reportPersist(false));
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/couldn.?t save/i);
    act(() => reportPersist(true));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
