// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { MessageStreamVirtualizer, MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE } from "../../../../src/features/chat/ui/message-virtualizer";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

describe("MessageStreamVirtualizer", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("pins to the virtualized end when content is appended while pinned", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first"], [180], "force-bottom");
    expect(container.scrollTop).toBe(80);

    renderVirtualItems(controller, container, ["first", "second"], [180, 220], "auto");

    expect(container.scrollTop).toBe(300);
    controller.dispose();
  });

  it("includes message container block padding in the virtualized end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    container.style.paddingLeft = "12px";
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first"], [180], "force-bottom");

    expect(controller.getTotalSize()).toBe(204);
    expect(container.scrollTop).toBe(104);
    controller.dispose();
  });

  it("does not follow appended content after the user scrolls away from the end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first"], [300], "force-bottom");
    expect(container.scrollTop).toBe(200);

    container.scrollTop = 80;
    container.dispatchEvent(new Event("scroll"));

    renderVirtualItems(controller, container, ["first", "second"], [300, 180], "auto");

    expect(container.scrollTop).toBe(80);
    controller.dispose();
  });

  it("repins when the user scrolls back to the end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "second"], [300, 180], "force-bottom");
    expect(container.scrollTop).toBe(380);

    container.scrollTop = 80;
    container.dispatchEvent(new Event("scroll"));

    container.scrollTop = 380;
    container.dispatchEvent(new Event("scroll"));

    renderVirtualItems(controller, container, ["first", "second", "third"], [300, 180, 140], "auto");

    expect(container.scrollTop).toBe(520);
    controller.dispose();
  });

  it("keeps forced bottom pinned when the programmatic scroll event sees stale DOM scroll size", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "submitted"], [300, 100], "force-bottom");
    expect(container.scrollTop).toBe(300);

    container.dataset["testScrollHeight"] = "420";
    container.dispatchEvent(new Event("scroll"));

    delete container.dataset["testScrollHeight"];
    renderVirtualItems(controller, container, ["first", "submitted", "reply"], [300, 100, 100], "auto");

    expect(container.scrollTop).toBe(400);
    controller.dispose();
  });

  it("keeps following the end when a pinned item grows after measurement", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "command"], [200, 100], "force-bottom");
    expect(container.scrollTop).toBe(200);

    container.dataset["testTotalSize"] = "450";
    measureVirtualItem(controller, "command", 1, 250);

    expect(container.scrollTop).toBe(350);
    controller.dispose();
  });

  it("uses the pre-render bottom position when appending after an item resize", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 160 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "second"], [200, 200], "force-bottom");
    expect(container.scrollTop).toBe(240);

    container.dataset["testTotalSize"] = "480";
    measureVirtualItem(controller, "second", 1, 280);

    renderVirtualItems(controller, container, ["first", "second", "third"], [200, 280, 120], "auto");

    expect(container.scrollTop).toBe(440);
    controller.dispose();
  });

  it("keeps the current reading position when an item below the viewport grows while unpinned", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "streaming"], [300, 100], "preserve");
    container.scrollTop = 100;
    container.dispatchEvent(new Event("scroll"));

    container.dataset["testTotalSize"] = "550";
    measureVirtualItem(controller, "streaming", 1, 250);

    expect(container.scrollTop).toBe(100);
    controller.dispose();
  });

  it("keeps the end pinned when a layout scroll arrives before the viewport resize observer", () => {
    withResizeObserver((triggerResize) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 160 });
      const controller = new MessageStreamVirtualizer();

      renderVirtualItems(controller, container, ["first", "second"], [240, 260], "force-bottom");
      expect(container.scrollTop).toBe(340);

      setContainerClientHeight(container, 130);
      container.scrollTop = 329;
      container.dispatchEvent(new Event("scroll"));

      expect(container.scrollTop).toBe(370);

      triggerResize();
      expect(container.scrollTop).toBe(370);

      setContainerClientHeight(container, 100);
      container.scrollTop = 340;
      container.dispatchEvent(new Event("scroll"));

      expect(container.scrollTop).toBe(400);

      triggerResize();
      expect(container.scrollTop).toBe(400);

      controller.dispose();
    });
  });

  it("keeps the reading position when the message viewport shrinks away from the end", () => {
    withResizeObserver((triggerResize) => {
      const container = messageContainer({ scrollTop: 0, clientHeight: 160 });
      const controller = new MessageStreamVirtualizer();

      renderVirtualItems(controller, container, ["first", "second"], [240, 260], "force-bottom");
      expect(container.scrollTop).toBe(340);

      container.scrollTop = 120;
      container.dispatchEvent(new Event("scroll"));
      setContainerClientHeight(container, 100);
      triggerResize();

      expect(container.scrollTop).toBe(120);
      controller.dispose();
    });
  });

  it("delegates older-content prepends to keyed end anchoring", () => {
    const container = messageContainer({ scrollTop: 140, clientHeight: 120 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "second"], [120, 180], "preserve");
    container.scrollTop = 140;
    container.dispatchEvent(new Event("scroll"));

    renderVirtualItems(controller, container, ["older", "first", "second"], [90, 120, 180], "preserve");

    expect(container.scrollTop).toBe(116);
    controller.dispose();
  });

  it("scrolls by two text lines for composer edge shortcuts", () => {
    const container = messageContainer({ scrollTop: 120, clientHeight: 100 });
    container.style.lineHeight = "18px";
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "second"], [240, 240], "preserve");
    container.scrollTop = 120;
    container.dispatchEvent(new Event("scroll"));

    controller.scrollByTextLines(-1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(84);

    controller.scrollByTextLines(1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(120);
    controller.dispose();
  });

  it("scrolls by a viewport step for composer PageUp and PageDown shortcuts", () => {
    const container = messageContainer({ scrollTop: 220, clientHeight: 200 });
    const controller = new MessageStreamVirtualizer();

    renderVirtualItems(controller, container, ["first", "second", "third"], [240, 240, 240], "preserve");
    container.scrollTop = 220;
    container.dispatchEvent(new Event("scroll"));

    controller.scrollByPage(-1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(60);

    controller.scrollByPage(1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(220);

    container.scrollTop = 510;
    container.dispatchEvent(new Event("scroll"));
    controller.scrollByPage(1);
    container.dispatchEvent(new Event("scroll"));
    expect(container.scrollTop).toBe(520);
    controller.dispose();
  });
});

function renderVirtualItems(
  controller: MessageStreamVirtualizer,
  container: HTMLElement,
  keys: string[],
  heights: number[],
  intent: "auto" | "force-bottom" | "preserve",
): void {
  const blocks = keys.map((key) => ({ key, node: null }));
  const plan = controller.prepareRender(container, intent, blocks);
  container.dataset["testTotalSize"] = String(heights.reduce((total, height) => total + height, 0) + messageBlockPadding(container) * 2);
  controller.getTotalSize();
  keys.forEach((key, index) => {
    measureVirtualItem(controller, key, index, heights[index] ?? 0);
  });
  controller.getTotalSize();
  const previousTop = container.scrollTop;
  controller.completeRender(plan);
  if (container.scrollTop !== previousTop) {
    container.dispatchEvent(new Event("scroll"));
  }
}

function measureVirtualItem(controller: MessageStreamVirtualizer, key: string, index: number, height: number): void {
  const element = document.createElement("div");
  element.setAttribute("data-codex-panel-block-key", key);
  element.setAttribute(MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE, String(index));
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  Object.defineProperty(element, "isConnected", { value: true, configurable: true });
  controller.measureElement(element);
}

function messageContainer(metrics: { scrollTop: number; clientHeight: number }): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  let clientHeight = metrics.clientHeight;
  container.dataset["testClientHeight"] = String(metrics.clientHeight);
  Object.defineProperties(container, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        const scrollSize = Math.max(container.scrollHeight, controllerTotalSize(container));
        scrollTop = Math.max(0, Math.min(value, Math.max(0, scrollSize - clientHeight)));
      },
      configurable: true,
    },
    scrollHeight: {
      get: () => {
        const scrollHeight = Number(container.dataset["testScrollHeight"]);
        return Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : controllerTotalSize(container);
      },
      configurable: true,
    },
    clientHeight: {
      get: () => {
        const nextClientHeight = Number(container.dataset["testClientHeight"]);
        clientHeight = Number.isFinite(nextClientHeight) && nextClientHeight > 0 ? nextClientHeight : clientHeight;
        return clientHeight;
      },
      configurable: true,
    },
    offsetHeight: {
      get: () => container.clientHeight,
      configurable: true,
    },
    clientWidth: { value: 240, configurable: true },
    offsetWidth: { value: 240, configurable: true },
  });
  document.body.appendChild(container);
  return container;
}

function setContainerClientHeight(container: HTMLElement, clientHeight: number): void {
  container.dataset["testClientHeight"] = String(clientHeight);
}

function controllerTotalSize(container: HTMLElement): number {
  const totalSize = Number(container.dataset["testTotalSize"]);
  return Number.isFinite(totalSize) && totalSize > 0 ? totalSize : 0;
}

function messageBlockPadding(container: HTMLElement): number {
  const value = Number.parseFloat(container.ownerDocument.defaultView?.getComputedStyle(container).paddingLeft ?? "");
  return Number.isFinite(value) ? value : 0;
}

function withResizeObserver(run: (triggerResize: () => void) => void): void {
  const previousResizeObserver = window.ResizeObserver;
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const callbacks: ResizeObserverCallback[] = [];
  const frames: FrameRequestCallback[] = [];
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe(): void {
      // Test callback triggering is explicit.
    }

    unobserve(): void {
      // Test callback triggering is explicit.
    }

    disconnect(): void {
      // Test callback triggering is explicit.
    }
  }
  window.ResizeObserver = TestResizeObserver;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
  try {
    run(() => {
      frames.splice(0);
      for (const callback of callbacks) callback([], {} as ResizeObserver);
      const pending = frames.splice(0);
      for (const frame of pending) frame(0);
    });
  } finally {
    window.ResizeObserver = previousResizeObserver;
    window.requestAnimationFrame = previousRequestAnimationFrame;
    window.cancelAnimationFrame = previousCancelAnimationFrame;
  }
}
