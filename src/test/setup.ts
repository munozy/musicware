import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount and clear the DOM after every test so renders don't accumulate
// across tests (we don't enable vitest `globals`, so register this explicitly).
afterEach(() => cleanup());

// jsdom's localStorage in this version doesn't expose a working Storage API
// (no clear()). The recorder persists takes there, so install a complete,
// Map-backed Storage shim that behaves like the real thing.
{
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

// jsdom has no canvas 2D context. The Visualizer guards on a null context and
// no-ops; stub getContext to return null cleanly (avoids jsdom "not implemented"
// noise) so rendering <App/> in tests is silent.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// jsdom does not implement PointerEvent. The keyboard uses pointer events
// (onPointerDown/Up/Leave/Cancel), so provide a minimal polyfill backed by
// MouseEvent — enough for fireEvent.pointerDown/pointerUp in tests.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  // @ts-expect-error assigning a polyfill onto the jsdom window
  window.PointerEvent = PointerEventPolyfill;
}
