import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount and clear the DOM after every test so renders don't accumulate
// across tests (we don't enable vitest `globals`, so register this explicitly).
afterEach(() => cleanup());

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
