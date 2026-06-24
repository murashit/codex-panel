// @vitest-environment jsdom

import { h, type ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../../../../../src/features/chat/ui/message-stream/content-events";
import {
  MessageStreamFlowFrame,
  type MessageStreamScrollCommand,
  type MessageStreamScrollControllerBinding,
  type MessageStreamScrollPort,
} from "../../../../../src/features/chat/ui/message-stream/flow-scroll";
import { renderUiRoot } from "../../../../../src/shared/ui/ui-root";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

describe("message stream flow scrolling", () => {
  beforeEach(() => {
    resizeObserverCallbacks = [];
    animationFrameCallbacks = [];
    window.ResizeObserver = TestResizeObserver;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback);
      return animationFrameCallbacks.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
    window.matchMedia = createTestMatchMedia(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("pins to the DOM scroll end and follows appended content while pinned", () => {
    const { controller, messages, render } = renderFlowMessageStream(["first"], { first: 300 });
    const scrollCalls = installScrollToCapture(messages);

    void act(() => {
      controller.dispatch({ kind: "show-latest" });
    });
    expect(messages.scrollTop).toBe(200);
    expect(scrollCalls).toEqual([]);

    render(["first", "second"], { first: 300, second: 180 });

    expect(messages.scrollTop).toBe(380);
    expect(scrollCalls).toEqual([]);
  });

  it("keeps the current reading position when content is appended after the user scrolls away", () => {
    const { controller, messages, render } = renderFlowMessageStream(["first"], { first: 300 });
    void act(() => {
      controller.dispatch({ kind: "show-latest" });
    });
    messages.scrollTop = 80;
    messages.dispatchEvent(new Event("scroll"));

    render(["first", "second"], { first: 300, second: 180 });

    expect(messages.scrollTop).toBe(80);
  });

  it("preserves the visible block when older history is prepended", () => {
    const { messages, render } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    messages.scrollTop = 320;
    messages.dispatchEvent(new Event("scroll"));

    render(["older", "first", "second"], { older: 180, first: 300, second: 300 });

    expect(messages.scrollTop).toBe(500);
  });

  it("preserves the visible block when older history is inserted after the history bar", () => {
    const { messages, render } = renderFlowMessageStream(["history-bar", "current", "next"], {
      "history-bar": 40,
      current: 300,
      next: 300,
    });
    messages.scrollTop = 80;
    messages.dispatchEvent(new Event("scroll"));

    render(["history-bar", "older", "current", "next"], {
      "history-bar": 40,
      older: 180,
      current: 300,
      next: 300,
    });

    expect(messages.scrollTop).toBe(260);
  });

  it("does not force the end when delayed content changes while the user is reading", () => {
    const { messages, blockElement, setHeights } = renderFlowMessageStream(["first", "second", "third"], {
      first: 300,
      second: 300,
      third: 300,
    });
    messages.scrollTop = 360;
    messages.dispatchEvent(new Event("scroll"));

    setHeights({ first: 500, second: 300, third: 300 });
    void act(() => {
      blockElement("first").dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT, { bubbles: true }));
    });

    expect(messages.scrollTop).toBe(360);
  });

  it("keeps hidden message streams pinned when the viewport size returns", () => {
    const restoreInitialMetrics = installMessageViewportPrototypeMetrics({ scrollHeight: 600, viewport: { width: 0, height: 0 } });
    const { messages, resizeViewport } = renderFlowMessageStream(
      ["first", "second"],
      { first: 300, second: 300 },
      {
        viewport: { width: 0, height: 0 },
      },
    );
    restoreInitialMetrics();

    expect(messages.scrollTop).toBe(600);

    resizeViewport({ width: 240, height: 100 });
    triggerResizeObserver();
    flushAnimationFrame();

    expect(messages.scrollTop).toBe(500);
  });

  it("does not double-adjust when the browser anchors a prepended block before effects run", () => {
    let nativeAnchoringApplied = false;
    const { messages, render } = renderFlowMessageStream(
      ["first", "second"],
      { first: 300, second: 300 },
      {
        blockNode(key) {
          if (key !== "older") return h("div", null, key);
          return h("div", {
            ref(element: HTMLDivElement | null) {
              if (!element || nativeAnchoringApplied) return;
              nativeAnchoringApplied = true;
              const viewport = element.closest<HTMLElement>(".codex-panel__messages");
              if (viewport) viewport.scrollTop += 180;
            },
          });
        },
      },
    );
    messages.scrollTop = 320;
    messages.dispatchEvent(new Event("scroll"));

    render(["older", "first", "second"], { older: 180, first: 300, second: 300 });

    expect(messages.scrollTop).toBe(500);
  });

  it("returns to the DOM scroll end after delayed message content renders while pinned", () => {
    const { controller, messages, blockElement, setHeights } = renderFlowMessageStream(["message"], { message: 300 });
    void act(() => {
      controller.dispatch({ kind: "show-latest" });
    });
    expect(messages.scrollTop).toBe(200);

    setHeights({ message: 420 });
    void act(() => {
      blockElement("message").dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT, { bubbles: true }));
    });

    expect(messages.scrollTop).toBe(320);
  });

  it("scrolls by composer text-line and page commands", () => {
    const { controller, messages } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    const scrollCalls = installScrollToCapture(messages);
    messages.style.lineHeight = "20px";
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));

    void act(() => {
      controller.dispatch({ kind: "scroll-by", amount: "text-lines", direction: -1 });
    });
    expect(messages.scrollTop).toBe(160);
    expect(scrollCalls).toEqual([{ top: 160, behavior: "smooth" }]);

    void act(() => {
      controller.dispatch({ kind: "scroll-by", amount: "page", direction: 1 });
    });
    expect(messages.scrollTop).toBe(240);
    expect(scrollCalls).toEqual([
      { top: 160, behavior: "smooth" },
      { top: 240, behavior: "smooth" },
    ]);
  });

  it("uses instant composer scrolling when reduced motion is preferred", () => {
    window.matchMedia = createTestMatchMedia(true);
    const { controller, messages } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    const scrollCalls = installScrollToCapture(messages);
    messages.style.lineHeight = "20px";
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));

    void act(() => {
      controller.dispatch({ kind: "scroll-by", amount: "text-lines", direction: -1 });
    });

    expect(messages.scrollTop).toBe(160);
    expect(scrollCalls).toEqual([]);
  });

  it("uses the normal text-line distance for repeated composer scrolling without smooth animation", () => {
    const { controller, messages } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    const scrollCalls = installScrollToCapture(messages);
    messages.style.lineHeight = "20px";
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));

    void act(() => {
      controller.dispatch({ kind: "scroll-by", amount: "text-lines", direction: -1, repeated: true });
    });

    expect(messages.scrollTop).toBe(160);
    expect(scrollCalls).toEqual([]);
  });

  it("uses the normal page distance for repeated composer page scrolling without smooth animation", () => {
    const { controller, messages } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    const scrollCalls = installScrollToCapture(messages);
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));

    void act(() => {
      controller.dispatch({ kind: "scroll-by", amount: "page", direction: 1, repeated: true });
    });

    expect(messages.scrollTop).toBe(320);
    expect(scrollCalls).toEqual([]);
  });

  it("scrolls to stream edges from composer commands", () => {
    const { controller, messages } = renderFlowMessageStream(["first", "second"], { first: 300, second: 300 });
    const scrollCalls = installScrollToCapture(messages);
    messages.scrollTop = 240;
    messages.dispatchEvent(new Event("scroll"));

    void act(() => {
      controller.dispatch({ kind: "scroll-to", edge: "start" });
    });
    expect(messages.scrollTop).toBe(0);
    expect(scrollCalls).toEqual([{ top: 0, behavior: "smooth" }]);

    void act(() => {
      controller.dispatch({ kind: "scroll-to", edge: "end" });
    });
    expect(messages.scrollTop).toBe(500);
    expect(scrollCalls).toEqual([
      { top: 0, behavior: "smooth" },
      { top: 500, behavior: "smooth" },
    ]);
  });
});

interface CapturedScrollToOptions {
  top: number | undefined;
  behavior: ScrollBehavior | undefined;
}

interface TestMessageStreamScrollController extends MessageStreamScrollControllerBinding {
  dispatch(command: MessageStreamScrollCommand): void;
}

function createTestMessageStreamScrollController(): TestMessageStreamScrollController {
  let port: MessageStreamScrollPort | null = null;
  return {
    mountScrollPort(nextPort) {
      port = nextPort;
      return () => {
        if (port === nextPort) port = null;
      };
    },
    dispatch(command) {
      port?.dispatchScrollCommand(command);
    },
  };
}

function renderFlowMessageStream(
  keys: readonly string[],
  heights: Record<string, number>,
  options: {
    blockNode?: (key: string) => UiNode;
    viewport?: { width: number; height: number };
  } = {},
): {
  controller: TestMessageStreamScrollController;
  messages: HTMLElement;
  render: (nextKeys: readonly string[], nextHeights: Record<string, number>) => void;
  setHeights: (nextHeights: Record<string, number>) => void;
  resizeViewport: (nextViewport: { width: number; height: number }) => void;
  blockElement: (key: string) => HTMLElement;
} {
  const parent = document.createElement("div");
  document.body.append(parent);
  const controller = createTestMessageStreamScrollController();
  let currentHeights = heights;
  let currentKeys = keys;
  let viewport = options.viewport ?? { width: 240, height: 100 };

  const render = (nextKeys: readonly string[], nextHeights: Record<string, number>) => {
    currentKeys = nextKeys;
    currentHeights = nextHeights;
    void act(() => {
      renderUiRoot(
        parent,
        h(MessageStreamFlowFrame, {
          blocks: nextKeys.map((key) => ({ key })),
          scrollController: controller,
          renderBlockContent: (block) => options.blockNode?.(block.key) ?? h("div", null, block.key),
        }),
      );
    });
  };

  render(keys, heights);
  const messages = messageViewport(parent);
  installFlowMetrics(
    messages,
    () => currentKeys,
    () => currentHeights,
    () => viewport,
  );

  return {
    controller,
    messages,
    render,
    setHeights(nextHeights) {
      currentHeights = nextHeights;
    },
    resizeViewport(nextViewport) {
      viewport = nextViewport;
    },
    blockElement(key) {
      const element = parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${key}"]`);
      if (!element) throw new Error(`Missing block ${key}`);
      return element;
    },
  };
}

function messageViewport(parent: HTMLElement): HTMLElement {
  const element = parent.querySelector<HTMLElement>(".codex-panel__messages");
  if (!element) throw new Error("Expected message viewport.");
  return element;
}

function installFlowMetrics(
  messages: HTMLElement,
  keys: () => readonly string[],
  heights: () => Record<string, number>,
  viewport: () => { width: number; height: number },
): void {
  const initialScrollTop = messages.scrollTop;
  Object.defineProperties(messages, {
    clientHeight: { get: () => viewport().height, configurable: true },
    offsetHeight: { get: () => viewport().height, configurable: true },
    clientWidth: { get: () => viewport().width, configurable: true },
    offsetWidth: { get: () => viewport().width, configurable: true },
    scrollHeight: {
      get: () => keys().reduce((total, key) => total + (heights()[key] ?? 0), 0),
      configurable: true,
    },
  });

  Object.defineProperty(messages, "scrollTop", {
    get: () => messageScrollTop.get(messages) ?? 0,
    set: (value: number) => {
      const max = Math.max(0, messages.scrollHeight - messages.clientHeight);
      messageScrollTop.set(messages, Math.max(0, Math.min(value, max)));
    },
    configurable: true,
  });
  messages.scrollTop = initialScrollTop;

  messages.getBoundingClientRect = () => messageRect(0, viewport().height);
  Array.from(messages.querySelectorAll<HTMLElement>(".codex-panel__message-block")).forEach((element) => {
    installBlockRect(element, messages, heights);
  });
}

function installScrollToCapture(messages: HTMLElement): CapturedScrollToOptions[] {
  const calls: CapturedScrollToOptions[] = [];
  messages.scrollTo = ((optionsOrX?: ScrollToOptions | number, y?: number) => {
    const top = typeof optionsOrX === "number" ? y : optionsOrX?.top;
    const behavior = typeof optionsOrX === "number" ? undefined : optionsOrX?.behavior;
    calls.push({ top, behavior });
    if (top !== undefined) messages.scrollTop = top;
  }) as typeof messages.scrollTo;
  return calls;
}

const messageScrollTop = new WeakMap<HTMLElement, number>();
let resizeObserverCallbacks: ResizeObserverCallback[] = [];
let animationFrameCallbacks: FrameRequestCallback[] = [];

function createTestMatchMedia(matches: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObserverCallbacks.push(callback);
  }

  observe(): void {
    // Test callback triggering is explicit.
  }

  unobserve(): void {
    // Test callback triggering is explicit.
  }

  disconnect(): void {
    resizeObserverCallbacks = resizeObserverCallbacks.filter((callback) => callback !== this.callback);
  }
}

function triggerResizeObserver(): void {
  void act(() => {
    for (const callback of resizeObserverCallbacks) callback([], {} as ResizeObserver);
  });
}

function flushAnimationFrame(): void {
  const callbacks = animationFrameCallbacks.splice(0);
  void act(() => {
    for (const callback of callbacks) callback(0);
  });
}

function installMessageViewportPrototypeMetrics(metrics: {
  scrollHeight: number;
  viewport: { width: number; height: number };
}): () => void {
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: {
      get() {
        return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.scrollHeight : 0;
      },
      configurable: true,
    },
    clientHeight: {
      get() {
        return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.viewport.height : 0;
      },
      configurable: true,
    },
    clientWidth: {
      get() {
        return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.viewport.width : 0;
      },
      configurable: true,
    },
    offsetHeight: {
      get() {
        return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.viewport.height : 0;
      },
      configurable: true,
    },
    offsetWidth: {
      get() {
        return this instanceof HTMLElement && this.classList.contains("codex-panel__messages") ? metrics.viewport.width : 0;
      },
      configurable: true,
    },
  });

  return () => {
    restorePrototypeProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
  };
}

function restorePrototypeProperty(object: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(object, key, descriptor);
  } else {
    Reflect.deleteProperty(object, key);
  }
}

function installBlockRect(element: HTMLElement, messages: HTMLElement, heights: () => Record<string, number>): void {
  element.getBoundingClientRect = () => {
    const key = element.dataset["codexPanelBlockKey"] ?? "";
    const siblings = Array.from(messages.querySelectorAll<HTMLElement>(".codex-panel__message-block"));
    const index = siblings.indexOf(element);
    const top = siblings
      .slice(0, Math.max(0, index))
      .reduce((total, candidate) => total + (heights()[candidate.dataset["codexPanelBlockKey"] ?? ""] ?? 0), -messages.scrollTop);
    return messageRect(top, heights()[key] ?? 0);
  };
}

function messageRect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 240,
    bottom: top + height,
    left: 0,
    width: 240,
    height,
    toJSON: () => ({}),
  };
}
