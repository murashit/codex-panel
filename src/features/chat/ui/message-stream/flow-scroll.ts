import { useLayoutEffect, useMemo, useRef } from "preact/hooks";

import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-events";
import type { MessageStreamBlock } from "./context";

type MessageScrollDirection = -1 | 1;

export type MessageStreamScrollCommand =
  | { kind: "show-latest" }
  | { kind: "scroll-by"; amount: "text-lines" | "page"; direction: MessageScrollDirection };

export interface MessageStreamScrollPort {
  dispatchScrollCommand(command: MessageStreamScrollCommand): void;
}

export interface MessageStreamScrollControllerBinding {
  mountScrollPort(port: MessageStreamScrollPort): () => void;
}

export interface MessageStreamFlowScrollView {
  notifyBlockLayout(element: HTMLElement | null): void;
}

interface MessageFlowReadingAnchor {
  key: string;
  top: number;
}

interface MessageFlowRuntime {
  container: HTMLElement | null;
  blocks: readonly MessageStreamBlock[];
  followingEnd: boolean;
  pendingAnchor: MessageFlowReadingAnchor | null;
  restoreFrame: number | null;
  resizeObserver: ResizeObserver | null;
}

export interface MessageStreamFlowScrollOptions {
  blocks: readonly MessageStreamBlock[];
  scrollController: MessageStreamScrollControllerBinding;
  scrollElementRef: { current: HTMLElement | null };
}

export function useMessageStreamFlowScroll({
  blocks,
  scrollController,
  scrollElementRef,
}: MessageStreamFlowScrollOptions): MessageStreamFlowScrollView {
  const runtimeRef = useRef<MessageFlowRuntime | null>(null);
  runtimeRef.current ??= createMessageFlowRuntime();
  const runtime = runtimeRef.current;
  const scrollPort = useMemo<MessageStreamScrollPort>(
    () => ({
      dispatchScrollCommand(command) {
        if (runtimeRef.current) applyMessageFlowScrollCommand(runtimeRef.current, command);
      },
    }),
    [],
  );

  if (scrollElementRef.current) prepareMessageFlowRender(runtime, scrollElementRef.current, blocks);

  useLayoutEffect(() => {
    const unregister = scrollController.mountScrollPort(scrollPort);
    return () => {
      unregister();
    };
  }, [scrollController, scrollPort]);

  useLayoutEffect(() => {
    return () => {
      if (!runtimeRef.current) return;
      disposeMessageFlowRuntime(runtimeRef.current);
      runtimeRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (runtime.container !== scrollElementRef.current) {
      prepareMessageFlowRender(runtime, scrollElementRef.current, blocks);
    }
    completeMessageFlowRender(runtime);
  });

  return useMemo(
    () => ({
      notifyBlockLayout(element) {
        handleMessageFlowBlockLayout(runtime, element);
      },
    }),
    [runtime],
  );
}

function createMessageFlowRuntime(): MessageFlowRuntime {
  return {
    container: null,
    blocks: [],
    followingEnd: false,
    pendingAnchor: null,
    restoreFrame: null,
    resizeObserver: null,
  };
}

function prepareMessageFlowRender(runtime: MessageFlowRuntime, container: HTMLElement | null, blocks: readonly MessageStreamBlock[]): void {
  attachMessageFlowContainer(runtime, container);
  if (!container) {
    runtime.blocks = blocks;
    runtime.pendingAnchor = null;
    return;
  }

  if (runtime.followingEnd || !messageFlowBlocksShifted(runtime.blocks, blocks)) {
    runtime.pendingAnchor = null;
  } else {
    runtime.pendingAnchor = captureMessageFlowReadingAnchor(container);
  }
  runtime.blocks = blocks;
}

function completeMessageFlowRender(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container) return;

  if (runtime.followingEnd) {
    scrollMessageFlowToEnd(runtime);
    return;
  }

  const anchor = runtime.pendingAnchor;
  runtime.pendingAnchor = null;
  if (anchor) restoreMessageFlowReadingAnchor(container, anchor);
}

function attachMessageFlowContainer(runtime: MessageFlowRuntime, container: HTMLElement | null): void {
  if (runtime.container === container) return;
  detachMessageFlowContainer(runtime);
  runtime.container = container;
  runtime.followingEnd = container ? isMessageFlowAtEnd(container) || isMessageFlowViewportHidden(container) : false;
  if (!container) return;

  const handleScroll = () => {
    runtime.followingEnd = isMessageFlowAtEnd(container);
  };
  const handleContentChange = () => {
    if (!runtime.followingEnd) return;
    scrollMessageFlowToEnd(runtime);
    scheduleMessageFlowEndRestore(runtime);
  };
  container.addEventListener("scroll", handleScroll, { passive: true });
  container.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, handleContentChange, true);
  container.addEventListener("toggle", handleContentChange, true);

  const win = container.ownerDocument.defaultView;
  if (win?.ResizeObserver) {
    runtime.resizeObserver = new win.ResizeObserver(() => {
      if (runtime.followingEnd) scheduleMessageFlowEndRestore(runtime);
    });
    runtime.resizeObserver.observe(container);
  }

  runtime.pendingAnchor = null;
  runtime.restoreFrame = null;
  cleanupMessageFlowContainer.set(runtime, () => {
    container.removeEventListener("scroll", handleScroll);
    container.removeEventListener(MESSAGE_CONTENT_RENDERED_EVENT, handleContentChange, true);
    container.removeEventListener("toggle", handleContentChange, true);
    runtime.resizeObserver?.disconnect();
    runtime.resizeObserver = null;
  });
}

const cleanupMessageFlowContainer = new WeakMap<MessageFlowRuntime, () => void>();

function detachMessageFlowContainer(runtime: MessageFlowRuntime): void {
  cancelMessageFlowEndRestore(runtime);
  cleanupMessageFlowContainer.get(runtime)?.();
  cleanupMessageFlowContainer.delete(runtime);
  runtime.container = null;
  runtime.pendingAnchor = null;
}

function disposeMessageFlowRuntime(runtime: MessageFlowRuntime): void {
  detachMessageFlowContainer(runtime);
  runtime.blocks = [];
  runtime.followingEnd = false;
}

function applyMessageFlowScrollCommand(runtime: MessageFlowRuntime, command: MessageStreamScrollCommand): void {
  switch (command.kind) {
    case "show-latest":
      runtime.followingEnd = true;
      scrollMessageFlowToEnd(runtime);
      scheduleMessageFlowEndRestore(runtime);
      break;
    case "scroll-by":
      scrollMessageFlowBy(runtime, messageFlowScrollDelta(runtime, command.amount, command.direction));
      break;
  }
}

function handleMessageFlowBlockLayout(runtime: MessageFlowRuntime, element: HTMLElement | null): void {
  if (!element || !runtime.followingEnd) return;
  scrollMessageFlowToEnd(runtime);
  scheduleMessageFlowEndRestore(runtime);
}

function scrollMessageFlowBy(runtime: MessageFlowRuntime, delta: number): void {
  const container = runtime.container;
  if (!container) return;
  container.scrollTop += delta;
  runtime.followingEnd = isMessageFlowAtEnd(container);
}

function messageFlowScrollDelta(runtime: MessageFlowRuntime, amount: "text-lines" | "page", direction: MessageScrollDirection): number {
  const container = runtime.container;
  if (!container) return 0;
  if (amount === "page") return Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
  return Math.max(1, Math.round(textLineHeight(container) * 2)) * direction;
}

function scrollMessageFlowToEnd(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container) return;
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  runtime.followingEnd = true;
}

function scheduleMessageFlowEndRestore(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  if (!container || runtime.restoreFrame !== null) return;
  runtime.restoreFrame = container.win.requestAnimationFrame(() => {
    runtime.restoreFrame = null;
    if (runtime.container === container && runtime.followingEnd) scrollMessageFlowToEnd(runtime);
  });
}

function cancelMessageFlowEndRestore(runtime: MessageFlowRuntime): void {
  const container = runtime.container;
  const frame = runtime.restoreFrame;
  if (container && frame !== null) container.win.cancelAnimationFrame(frame);
  runtime.restoreFrame = null;
}

function messageFlowBlocksShifted(previous: readonly MessageStreamBlock[], next: readonly MessageStreamBlock[]): boolean {
  if (previous.length === 0 || next.length === 0) return false;
  if (previous.length !== next.length) return true;
  return previous.some((block, index) => block.key !== next[index]?.key);
}

function captureMessageFlowReadingAnchor(container: HTMLElement): MessageFlowReadingAnchor | null {
  const viewportTop = container.getBoundingClientRect().top;
  for (const element of messageFlowBlockElements(container)) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= viewportTop) {
      const key = element.dataset["codexPanelBlockKey"];
      return key ? { key, top: rect.top - viewportTop } : null;
    }
  }
  return null;
}

function restoreMessageFlowReadingAnchor(container: HTMLElement, anchor: MessageFlowReadingAnchor): void {
  const element = messageFlowBlockElements(container).find((candidate) => candidate.dataset["codexPanelBlockKey"] === anchor.key);
  if (!element) return;
  const viewportTop = container.getBoundingClientRect().top;
  const currentTop = element.getBoundingClientRect().top - viewportTop;
  container.scrollTop += currentTop - anchor.top;
}

function messageFlowBlockElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".codex-panel__message-block"));
}

function isMessageFlowAtEnd(container: HTMLElement): boolean {
  return container.scrollHeight - container.clientHeight - container.scrollTop <= 4;
}

function isMessageFlowViewportHidden(container: HTMLElement): boolean {
  return container.clientWidth <= 0 || container.clientHeight <= 0;
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
