import { afterEach, beforeEach, vi } from "vitest";
import { installObsidianDomShims } from "../../../../../support/dom";

export function setupThreadStreamRendering(): void {
  installObsidianDomShims();
  let callbacks = new Map<number, FrameRequestCallback>();
  beforeEach(() => {
    let nextAnimationFrameId = 1;
    callbacks = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++;
      callbacks.set(id, callback);
      queueMicrotask(() => {
        const scheduled = callbacks.get(id);
        if (!scheduled) return;
        callbacks.delete(id);
        scheduled(0);
      });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  });
  afterEach(() => {
    callbacks.clear();
    vi.unstubAllGlobals();
  });
}
