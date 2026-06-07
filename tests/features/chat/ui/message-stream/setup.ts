import { installObsidianDomShims } from "../../../../support/dom";
import { beforeEach } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installObsidianDomShims();

beforeEach(() => {
  let nextAnimationFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (callback) => {
    const id = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    callbacks.set(id, callback);
    queueMicrotask(() => {
      const scheduled = callbacks.get(id);
      if (!scheduled) return;
      callbacks.delete(id);
      scheduled(0);
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
});
