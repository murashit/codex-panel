// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bottomScrollTop,
  captureScrollAnchor,
  isNearScrollBottom,
  MessageScrollController,
  restoreScrollAnchor,
} from "../../../../src/features/chat/ui/scroll";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
installTestAnimationFrame();

describe("message scroll helpers", () => {
  it("detects whether the transcript is pinned near the bottom", () => {
    expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 677, clientHeight: 320 })).toBe(true);
    expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 676, clientHeight: 320 })).toBe(false);
  });

  it("uses the full scroll height for bottom pinning", () => {
    expect(bottomScrollTop({ scrollHeight: 1200 })).toBe(1200);
  });

  it("captures and restores the first visible message block", () => {
    const container = messageContainer({ scrollTop: 150, scrollHeight: 1000, clientHeight: 300 });
    const first = messageBlock("first", 0, 120);
    const second = messageBlock("second", 120, 160);
    container.append(first, second);

    const anchor = captureScrollAnchor(container);

    expect(anchor).toEqual({ key: "second", offset: -30, fallbackTop: 150 });

    setLayout(second, 360, 160);
    restoreScrollAnchor(container, anchor);

    expect(container.scrollTop).toBe(390);
  });

  it("falls back to the previous scroll top when the anchor block disappears", () => {
    const container = messageContainer({ scrollTop: 150, scrollHeight: 1000, clientHeight: 300 });
    container.append(messageBlock("first", 0, 120), messageBlock("second", 120, 160));
    const anchor = captureScrollAnchor(container);
    container.replaceChildren(messageBlock("other", 0, 120));

    restoreScrollAnchor(container, anchor);

    expect(container.scrollTop).toBe(150);
  });

  it("keeps the scroll container pinned after an observed message block grows", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 997, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    expect(container.scrollTop).toBe(1000);

    setScrollHeight(container, 1200);
    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(1200);
    expect(pinned).toBe(true);
    controller.dispose();
    resizeObserver.restore();
  });

  it("keeps the pinned state when content growth fires a scroll event before resize correction", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 997, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    expect(container.scrollTop).toBe(1000);

    setScrollHeight(container, 1400);
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(true);

    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(1400);
    expect(pinned).toBe(true);
    controller.dispose();
    resizeObserver.restore();
  });

  it("keeps the pinned state when scroll anchoring moves down during content growth", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 997, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    expect(container.scrollTop).toBe(1000);

    setScrollHeight(container, 1400);
    container.scrollTop = 1150;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(true);

    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(1400);
    expect(pinned).toBe(true);
    controller.dispose();
    resizeObserver.restore();
  });

  it("restores the remembered message block after an observed size change while reading history", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 150, scrollHeight: 1000, clientHeight: 300 });
    const first = messageBlock("first", 0, 120);
    const second = messageBlock("second", 120, 160);
    container.append(first, second);
    let pinned = false;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "preserve"));
    await animationFrame(container);

    setLayout(second, 360, 160);
    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(390);
    expect(pinned).toBe(false);
    controller.dispose();
    resizeObserver.restore();
  });

  it("unpins immediately when the user scrolls upward from the pinned bottom", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 920, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    expect(container.scrollTop).toBe(1000);

    container.scrollTop = 990;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(false);

    setScrollHeight(container, 1200);
    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(990);
    expect(pinned).toBe(false);
    controller.dispose();
    resizeObserver.restore();
  });

  it("repins after the user scrolls back to the bottom", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 920, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    container.scrollTop = 990;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(false);

    setScrollHeight(container, 1200);
    container.scrollTop = 1197;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(true);

    setScrollHeight(container, 1300);
    resizeObserver.trigger();
    await animationFrame(container);

    expect(container.scrollTop).toBe(1300);
    expect(pinned).toBe(true);
    controller.dispose();
    resizeObserver.restore();
  });

  it("honors a forced bottom scroll after the user unpinned streaming output", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 920, scrollHeight: 1000, clientHeight: 100 });
    container.append(messageBlock("message", 0, 1000));
    let pinned = true;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "auto"));
    await animationFrame(container);
    container.scrollTop = 990;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(false);

    setScrollHeight(container, 1200);
    controller.completeRender(controller.prepareRender(container, "force-bottom"));
    await animationFrame(container);

    expect(container.scrollTop).toBe(1200);
    expect(pinned).toBe(true);
    controller.dispose();
    resizeObserver.restore();
  });

  it("scrolls by two text lines for composer edge shortcuts", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 400, scrollHeight: 1200, clientHeight: 200 });
    container.style.lineHeight = "18px";
    container.append(messageBlock("message", 0, 1200));
    let pinned = false;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "preserve"));
    await animationFrame(container);
    controller.scrollByTextLines(-1);

    expect(container.scrollTop).toBe(364);
    expect(pinned).toBe(false);

    controller.scrollByTextLines(1);

    expect(container.scrollTop).toBe(400);
    expect(pinned).toBe(false);

    container.scrollTop = 950;
    controller.scrollByTextLines(1);

    expect(container.scrollTop).toBe(986);
    expect(pinned).toBe(false);

    controller.dispose();
    resizeObserver.restore();
  });

  it("scrolls by a viewport step for composer PageUp and PageDown shortcuts", async () => {
    const resizeObserver = installResizeObserver();
    const container = messageContainer({ scrollTop: 400, scrollHeight: 1200, clientHeight: 200 });
    container.append(messageBlock("message", 0, 1200));
    let pinned = false;
    const controller = new MessageScrollController({
      messagesPinnedToBottom: () => pinned,
      setMessagesPinnedToBottom: (value) => {
        pinned = value;
      },
    });

    controller.completeRender(controller.prepareRender(container, "preserve"));
    await animationFrame(container);
    controller.scrollByPage(-1);

    expect(container.scrollTop).toBe(240);
    expect(pinned).toBe(false);

    controller.scrollByPage(1);

    expect(container.scrollTop).toBe(400);
    expect(pinned).toBe(false);

    container.scrollTop = 950;
    controller.scrollByPage(1);

    expect(container.scrollTop).toBe(1000);
    expect(pinned).toBe(true);

    controller.dispose();
    resizeObserver.restore();
  });
});

function messageContainer(metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  let scrollHeight = metrics.scrollHeight;
  Object.defineProperties(container, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    },
    scrollHeight: {
      get: () => scrollHeight,
      configurable: true,
    },
    clientHeight: { value: metrics.clientHeight, configurable: true },
  });
  Object.defineProperty(container, "setTestScrollHeight", {
    value: (value: number) => {
      scrollHeight = value;
    },
  });
  return container;
}

function messageBlock(key: string, offsetTop: number, offsetHeight: number): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-codex-panel-block-key", key);
  setLayout(element, offsetTop, offsetHeight);
  return element;
}

function setLayout(element: HTMLElement, offsetTop: number, offsetHeight: number): void {
  Object.defineProperties(element, {
    offsetTop: { value: offsetTop, configurable: true },
    offsetHeight: { value: offsetHeight, configurable: true },
  });
}

function setScrollHeight(container: HTMLElement, value: number): void {
  (container as HTMLElement & { setTestScrollHeight: (scrollHeight: number) => void }).setTestScrollHeight(value);
}

function animationFrame(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function installTestAnimationFrame(): void {
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
  let callbacks: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    callbacks = new Map();
    nextAnimationFrameId = 1;

    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
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
    window.cancelAnimationFrame = (id: number): void => {
      callbacks.delete(id);
    };
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });
}

function installResizeObserver(): {
  trigger: () => void;
  restore: () => void;
} {
  const win = window as Window & { ResizeObserver?: typeof ResizeObserver };
  const original = Reflect.get(win, "ResizeObserver") as typeof ResizeObserver | undefined;
  let currentCallback: ResizeObserverCallback | null = null;

  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      currentCallback = callback;
    }

    observe(): void {
      // The tests trigger observer notifications explicitly.
    }

    unobserve(): void {
      // The tests trigger observer notifications explicitly.
    }

    disconnect(): void {
      currentCallback = null;
    }

    trigger(): void {
      currentCallback?.([], this as unknown as ResizeObserver);
    }
  }

  win.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

  return {
    trigger: () => {
      if (!currentCallback) throw new Error("ResizeObserver was not installed.");
      currentCallback([], {} as ResizeObserver);
    },
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(win, "ResizeObserver");
      } else {
        win.ResizeObserver = original;
      }
    },
  };
}
