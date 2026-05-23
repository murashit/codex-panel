// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { bottomScrollTop, captureScrollAnchor, isNearScrollBottom, restoreScrollAnchor } from "../../src/features/chat/ui/scroll";

describe("message scroll helpers", () => {
  it("detects whether the transcript is pinned near the bottom", () => {
    expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 620, clientHeight: 320 })).toBe(true);
    expect(isNearScrollBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 320 })).toBe(false);
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
});

function messageContainer(metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }): HTMLElement {
  const container = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  Object.defineProperties(container, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    },
    scrollHeight: { value: metrics.scrollHeight, configurable: true },
    clientHeight: { value: metrics.clientHeight, configurable: true },
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
