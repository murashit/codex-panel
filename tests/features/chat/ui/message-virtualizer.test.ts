// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { MessageStreamVirtualizer, MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE } from "../../../../src/features/chat/ui/message-virtualizer";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

describe("MessageStreamVirtualizer", () => {
  it("pins to the virtualized end when content is appended while pinned", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    let pinned = true;
    const controller = controllerWithPinnedState(
      () => pinned,
      (value) => {
        pinned = value;
      },
    );

    renderVirtualItems(controller, container, ["first"], [180], "force-bottom");
    expect(container.scrollTop).toBe(80);
    expect(pinned).toBe(true);

    renderVirtualItems(controller, container, ["first", "second"], [180, 220], "auto");

    expect(container.scrollTop).toBe(300);
    expect(pinned).toBe(true);
    controller.dispose();
  });

  it("does not follow appended content after the user scrolls away from the end", () => {
    const container = messageContainer({ scrollTop: 0, clientHeight: 100 });
    let pinned = true;
    const controller = controllerWithPinnedState(
      () => pinned,
      (value) => {
        pinned = value;
      },
    );

    renderVirtualItems(controller, container, ["first"], [300], "force-bottom");
    expect(container.scrollTop).toBe(200);

    container.scrollTop = 80;
    container.dispatchEvent(new Event("scroll"));
    expect(pinned).toBe(false);

    renderVirtualItems(controller, container, ["first", "second"], [300, 180], "auto");

    expect(container.scrollTop).toBe(80);
    expect(pinned).toBe(false);
    controller.dispose();
  });

  it("delegates older-content prepends to keyed end anchoring", () => {
    const container = messageContainer({ scrollTop: 140, clientHeight: 120 });
    let pinned = false;
    const controller = controllerWithPinnedState(
      () => pinned,
      (value) => {
        pinned = value;
      },
    );

    renderVirtualItems(controller, container, ["first", "second"], [120, 180], "preserve");
    container.scrollTop = 140;
    container.dispatchEvent(new Event("scroll"));

    renderVirtualItems(controller, container, ["older", "first", "second"], [90, 120, 180], "preserve");

    expect(container.scrollTop).toBe(116);
    expect(pinned).toBe(false);
    controller.dispose();
  });

  it("scrolls by two text lines for composer edge shortcuts", () => {
    const container = messageContainer({ scrollTop: 120, clientHeight: 100 });
    container.style.lineHeight = "18px";
    let pinned = false;
    const controller = controllerWithPinnedState(
      () => pinned,
      (value) => {
        pinned = value;
      },
    );

    renderVirtualItems(controller, container, ["first", "second"], [240, 240], "preserve");
    container.scrollTop = 120;
    container.dispatchEvent(new Event("scroll"));

    controller.scrollByTextLines(-1);
    expect(container.scrollTop).toBe(84);
    expect(pinned).toBe(false);

    controller.scrollByTextLines(1);
    expect(container.scrollTop).toBe(120);
    expect(pinned).toBe(false);
    controller.dispose();
  });

  it("scrolls by a viewport step for composer PageUp and PageDown shortcuts", () => {
    const container = messageContainer({ scrollTop: 220, clientHeight: 200 });
    let pinned = false;
    const controller = controllerWithPinnedState(
      () => pinned,
      (value) => {
        pinned = value;
      },
    );

    renderVirtualItems(controller, container, ["first", "second", "third"], [240, 240, 240], "preserve");
    container.scrollTop = 220;
    container.dispatchEvent(new Event("scroll"));

    controller.scrollByPage(-1);
    expect(container.scrollTop).toBe(60);
    expect(pinned).toBe(false);

    controller.scrollByPage(1);
    expect(container.scrollTop).toBe(220);
    expect(pinned).toBe(false);

    container.scrollTop = 510;
    container.dispatchEvent(new Event("scroll"));
    controller.scrollByPage(1);
    expect(container.scrollTop).toBe(520);
    expect(pinned).toBe(true);
    controller.dispose();
  });
});

function controllerWithPinnedState(
  messagesPinnedToBottom: () => boolean,
  setMessagesPinnedToBottom: (pinned: boolean) => void,
): MessageStreamVirtualizer {
  return new MessageStreamVirtualizer({ messagesPinnedToBottom, setMessagesPinnedToBottom });
}

function renderVirtualItems(
  controller: MessageStreamVirtualizer,
  container: HTMLElement,
  keys: string[],
  heights: number[],
  intent: "auto" | "force-bottom" | "preserve",
): void {
  const blocks = keys.map((key) => ({ key, node: null }));
  container.dataset["testTotalSize"] = String(heights.reduce((total, height) => total + height, 0));
  const plan = controller.prepareRender(container, intent, blocks);
  controller.getTotalSize();
  keys.forEach((key, index) => {
    const element = document.createElement("div");
    element.setAttribute("data-codex-panel-block-key", key);
    element.setAttribute(MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE, String(index));
    Object.defineProperty(element, "offsetHeight", { value: heights[index], configurable: true });
    Object.defineProperty(element, "isConnected", { value: true, configurable: true });
    controller.measureElement(element);
  });
  controller.getTotalSize();
  controller.completeRender(plan);
}

function messageContainer(metrics: { scrollTop: number; clientHeight: number }): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  let clientHeight = metrics.clientHeight;
  Object.defineProperties(container, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, Math.max(0, container.scrollHeight - clientHeight)));
      },
      configurable: true,
    },
    scrollHeight: {
      get: () => controllerTotalSize(container),
      configurable: true,
    },
    clientHeight: {
      get: () => clientHeight,
      configurable: true,
    },
    clientWidth: { value: 240, configurable: true },
  });
  Object.defineProperty(container, "setTestClientHeight", {
    value: (value: number) => {
      clientHeight = value;
    },
  });
  return container;
}

function controllerTotalSize(container: HTMLElement): number {
  const totalSize = Number(container.dataset["testTotalSize"]);
  return Number.isFinite(totalSize) && totalSize > 0 ? totalSize : 0;
}
