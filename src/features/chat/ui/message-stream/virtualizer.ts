import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

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

interface MessageVirtualizerReadingAnchor {
  key: unknown;
  top: number;
}

type MessageVirtualizerScrollLock = { kind: "none" } | { kind: "end" } | { kind: "anchor"; anchor: MessageVirtualizerReadingAnchor | null };
type MessageVirtualizerUserScrollState = "idle" | "pending" | "active";

interface MessageVirtualizerLayoutReconcileRequest {
  requireSettleFrame: boolean;
  scheduleSettle: boolean;
  clampAnchorToEnd: boolean;
}

const MESSAGE_BOTTOM_THRESHOLD = 4;
const MESSAGE_BLOCK_ESTIMATE_SIZE = 96;
const MESSAGE_SCROLL_TO_END_SETTLE_ATTEMPTS = 4;
export interface MessageStreamVirtualizerView {
  getTotalSize(): number;
  getVirtualItems(): VirtualItem[];
  measureElement(element: HTMLElement | null): void;
}

interface MessageVirtualizerRuntime {
  container: HTMLElement | null;
  virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  cleanupVirtualizer: (() => void) | null;
  blocks: readonly MessageStreamBlock[];
  pendingLayoutReconcile: MessageVirtualizerLayoutReconcileRequest | null;
  onVirtualizerChange: (() => void) | null;
  scrollLock: MessageVirtualizerScrollLock;
  viewportMeasurementsInvalid: boolean;
  viewportRestoreFrame: number | null;
  virtualizerChangeFrame: number | null;
  settleScrollToEndFrame: number | null;
  settleScrollToEndAttemptsRemaining: number;
  userScroll: MessageVirtualizerUserScrollState;
}

type MessageVirtualizerFrameKey = "viewportRestoreFrame" | "virtualizerChangeFrame" | "settleScrollToEndFrame";

export interface MessageStreamVirtualizerOptions {
  blocks: readonly MessageStreamBlock[];
  scrollController: MessageStreamScrollControllerBinding;
  scrollElementRef: { current: HTMLElement | null };
}

export function useMessageStreamVirtualizer({
  blocks,
  scrollController,
  scrollElementRef,
}: MessageStreamVirtualizerOptions): MessageStreamVirtualizerView {
  const runtimeRef = useRef<MessageVirtualizerRuntime | null>(null);
  runtimeRef.current ??= createMessageVirtualizerRuntime();
  const runtime = runtimeRef.current;
  const scrollPort = useMemo<MessageStreamScrollPort>(
    () => ({
      dispatchScrollCommand(command) {
        if (runtimeRef.current) applyMessageVirtualizerScrollCommand(runtimeRef.current, command);
      },
    }),
    [],
  );
  const [, setVersion] = useState(0);

  useLayoutEffect(() => {
    const unregister = scrollController.mountScrollPort(scrollPort);
    return () => {
      unregister();
    };
  }, [scrollController, scrollPort]);

  useLayoutEffect(() => {
    return () => {
      if (!runtimeRef.current) return;
      disposeMessageVirtualizer(runtimeRef.current);
      runtimeRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    setMessageVirtualizerChangeHandler(runtime, () => {
      setVersion((version) => version + 1);
    });
    return () => {
      setMessageVirtualizerChangeHandler(runtime, null);
    };
  }, [runtime]);

  useLayoutEffect(() => {
    // Run before the render effect below: requests made during one commit reconcile after the DOM for the next commit exists.
    reconcileMessageVirtualizerLayoutAfterCommit(runtime);
  });

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;
    renderMessageVirtualizer(runtime, scrollElement, blocks);
    setVersion((version) => version + 1);
  }, [blocks, runtime, scrollElementRef]);

  return useMemo(
    () => ({
      getTotalSize() {
        return getMessageVirtualizerTotalSize(runtime);
      },
      getVirtualItems() {
        return getMessageVirtualizerItems(runtime);
      },
      measureElement(element) {
        measureMessageVirtualizerElement(runtime, element);
      },
    }),
    [runtime],
  );
}

function createMessageVirtualizerRuntime(): MessageVirtualizerRuntime {
  const runtime: MessageVirtualizerRuntime = {
    container: null,
    blocks: [],
    virtualizer: null as never,
    cleanupVirtualizer: null,
    pendingLayoutReconcile: null,
    onVirtualizerChange: null,
    scrollLock: { kind: "none" },
    viewportMeasurementsInvalid: false,
    viewportRestoreFrame: null,
    virtualizerChangeFrame: null,
    settleScrollToEndFrame: null,
    settleScrollToEndAttemptsRemaining: 0,
    userScroll: "idle",
  };
  runtime.virtualizer = new Virtualizer(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
  return runtime;
}

function renderMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement, blocks: readonly MessageStreamBlock[]): void {
  attachMessageVirtualizer(runtime, container);
  handleMessageVirtualizerViewportElement(runtime, container);

  const appendingBlocks = blocks.length > runtime.blocks.length;
  const shouldFollowAppend =
    appendingBlocks && (hasMessageVirtualizerEndLock(runtime) || isMessageVirtualizerObservedAtEnd(runtime, container));
  if (isMessageVirtualizerInsertingBeforeExistingBlocks(runtime.blocks, blocks)) {
    setMessageVirtualizerAnchorLock(runtime, captureMessageVirtualizerReadingAnchorValue(runtime));
    cancelPendingMessageVirtualizerReconcile(runtime);
  }
  runtime.blocks = blocks;
  if (blocks.length > 0 && shouldFollowAppend) setMessageVirtualizerEndLock(runtime);
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  requestMessageVirtualizerLayoutReconcile(runtime);
}

function applyMessageVirtualizerScrollCommand(runtime: MessageVirtualizerRuntime, command: MessageStreamScrollCommand): void {
  switch (command.kind) {
    case "show-latest":
      pinMessageVirtualizerToBottom(runtime);
      break;
    case "scroll-by":
      if (command.amount === "page") {
        scrollMessageVirtualizerByPage(runtime, command.direction);
      } else {
        scrollMessageVirtualizerByTextLines(runtime, command.direction);
      }
      break;
  }
}

function isMessageVirtualizerInsertingBeforeExistingBlocks(
  previousBlocks: readonly MessageStreamBlock[],
  nextBlocks: readonly MessageStreamBlock[],
): boolean {
  if (previousBlocks.length === 0 || nextBlocks.length <= previousBlocks.length) return false;
  const matchedIndexes: number[] = [];
  let searchStart = 0;
  for (const previousBlock of previousBlocks) {
    const nextIndex = findMessageVirtualizerBlockIndexByKey(nextBlocks, previousBlock.key, searchStart);
    if (nextIndex < 0) return false;
    matchedIndexes.push(nextIndex);
    searchStart = nextIndex + 1;
  }
  return matchedIndexes.some((nextIndex, previousIndex) => nextIndex !== previousIndex);
}

function findMessageVirtualizerBlockIndexByKey(blocks: readonly MessageStreamBlock[], key: unknown, startIndex: number): number {
  for (let index = startIndex; index < blocks.length; index += 1) {
    if (Object.is(blocks[index]?.key, key)) return index;
  }
  return -1;
}

function getMessageVirtualizerTotalSize(runtime: MessageVirtualizerRuntime): number {
  const totalSize = runtime.virtualizer.getTotalSize();
  const container = runtime.container;
  if (!container || !isMessageVirtualizerAnchorLocked(runtime)) return totalSize;
  return Math.max(totalSize, container.scrollTop + container.clientHeight + MESSAGE_BOTTOM_THRESHOLD + 1);
}

function getMessageVirtualizerItems(runtime: MessageVirtualizerRuntime): VirtualItem[] {
  return runtime.virtualizer.getVirtualItems();
}

function measureMessageVirtualizerElement(runtime: MessageVirtualizerRuntime, element: HTMLElement | null): void {
  prepareMessageVirtualizerMeasurement(runtime);
  runtime.virtualizer.measureElement(element);
  if (element) {
    requestMessageVirtualizerLayoutReconcile(runtime, {
      notify: true,
      requireSettleFrame: true,
    });
  }
}

function prepareMessageVirtualizerMeasurement(runtime: MessageVirtualizerRuntime): void {
  const wasFollowingEnd = hasMessageVirtualizerEndLock(runtime);
  const scrollOffsetMovedAwayFromEnd = syncMessageVirtualizerScrollOffset(runtime);
  if (wasFollowingEnd && !scrollOffsetMovedAwayFromEnd) setMessageVirtualizerEndLock(runtime);
}

function reconcileMessageVirtualizerLayoutAfterCommit(runtime: MessageVirtualizerRuntime): void {
  const request = runtime.pendingLayoutReconcile;
  if (!request) return;
  runtime.pendingLayoutReconcile = null;
  reconcileMessageVirtualizerLayout(runtime, request);
}

function measureRenderedMessageBlocks(runtime: MessageVirtualizerRuntime): void {
  for (const element of renderedMessageBlockElements(runtime.container)) {
    if (!isCurrentMessageBlockElement(runtime, element)) continue;
    runtime.virtualizer.measureElement(element);
  }
}

function isCurrentMessageBlockElement(runtime: MessageVirtualizerRuntime, element: HTMLElement): boolean {
  const key = element.dataset["codexPanelBlockKey"];
  return key !== undefined && runtime.blocks.some((block) => block.key === key);
}

function renderedMessageBlockElements(container: HTMLElement | null): HTMLElement[] {
  const virtualizer = Array.from(container?.children ?? []).find(
    (element): element is HTMLElement => "offsetHeight" in element && element.classList.contains("codex-panel__message-virtualizer"),
  );
  if (!virtualizer) return [];
  return Array.from(virtualizer.children).filter(
    (element): element is HTMLElement => "offsetHeight" in element && element.classList.contains("codex-panel__message-block"),
  );
}

function syncMessageVirtualizerScrollOffset(runtime: MessageVirtualizerRuntime): boolean {
  const container = runtime.container;
  if (!container) return false;
  if (hasMessageVirtualizerEndLock(runtime) && hasPendingMessageVirtualizerScrollToEnd(runtime)) return false;
  const offset = container.scrollTop;
  const previousOffset = runtime.virtualizer.scrollOffset;
  const offsetChanged = previousOffset !== null && offset !== previousOffset;
  if (previousOffset !== null && offset !== previousOffset) {
    runtime.virtualizer.scrollDirection = offset < previousOffset ? "backward" : "forward";
  }
  runtime.virtualizer.scrollOffset = offset;
  const scrollOffsetMovedAwayFromEnd = messageVirtualizerScrollOffsetMovedAwayFromEnd(runtime, container, offsetChanged);
  if (scrollOffsetMovedAwayFromEnd) {
    setMessageVirtualizerAnchorLock(runtime, runtime.scrollLock.kind === "anchor" ? runtime.scrollLock.anchor : null);
  }
  return scrollOffsetMovedAwayFromEnd;
}

function isMessageVirtualizerObservedAtEnd(runtime: MessageVirtualizerRuntime, container = runtime.container): boolean {
  if (!container) return false;
  return isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD);
}

function messageVirtualizerScrollOffsetMovedAwayFromEnd(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  offsetChanged: boolean,
): boolean {
  return offsetChanged && !isMessageVirtualizerObservedAtEnd(runtime, container);
}

function hasPendingMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.settleScrollToEndFrame !== null;
}

function setMessageVirtualizerEndLock(runtime: MessageVirtualizerRuntime): void {
  runtime.scrollLock = { kind: "end" };
  updateMessageVirtualizerOptions(runtime);
}

function clearMessageVirtualizerEndLock(runtime: MessageVirtualizerRuntime): void {
  if (runtime.scrollLock.kind === "end") runtime.scrollLock = { kind: "none" };
}

function setMessageVirtualizerAnchorLock(runtime: MessageVirtualizerRuntime, anchor: MessageVirtualizerReadingAnchor | null): void {
  runtime.scrollLock = { kind: "anchor", anchor };
  updateMessageVirtualizerOptions(runtime);
}

function resetMessageVirtualizerScrollLock(runtime: MessageVirtualizerRuntime): void {
  runtime.scrollLock = { kind: "none" };
  updateMessageVirtualizerOptions(runtime);
}

function cancelPendingMessageVirtualizerReconcile(runtime: MessageVirtualizerRuntime): void {
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.pendingLayoutReconcile = null;
}

function setMessageVirtualizerChangeHandler(runtime: MessageVirtualizerRuntime, callback: (() => void) | null): void {
  runtime.onVirtualizerChange = callback;
}

function pinMessageVirtualizerToBottom(runtime: MessageVirtualizerRuntime, container = runtime.container): void {
  if (!container) return;
  attachMessageVirtualizer(runtime, container);
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  requestMessageVirtualizerEndLock(runtime, { notify: true });
}

function resetMessageVirtualizerMeasurements(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) return;
  // A hidden Obsidian pane can leave TanStack measurements stale while the message stream state is still valid.
  // Reset only the virtualizer runtime, then measure the still-rendered blocks.
  resetMessageVirtualizer(runtime, container);
  notifyMessageVirtualizerChange(runtime);
  measureRenderedMessageBlocks(runtime);
}

function handleMessageVirtualizerViewportRect(
  runtime: MessageVirtualizerRuntime,
  rect: { width: number; height: number },
  options: { notify?: boolean } = {},
): void {
  if (isInvalidMessageViewportRect(rect)) {
    runtime.viewportMeasurementsInvalid = true;
    cancelViewportRestoreMessageVirtualizerReset(runtime);
    return;
  }
  if (hasMessageVirtualizerEndLock(runtime)) {
    requestMessageVirtualizerEndLock(runtime, {
      ...(options.notify === undefined ? {} : { notify: options.notify }),
      requireSettleFrame: true,
    });
  }
  if (!runtime.viewportMeasurementsInvalid) return;
  scheduleViewportRestoreMessageVirtualizerReset(runtime);
}

function scheduleViewportRestoreMessageVirtualizerReset(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container || runtime.viewportRestoreFrame !== null) return;
  scheduleMessageVirtualizerFrame(runtime, "viewportRestoreFrame", container, () => {
    if (runtime.container !== container || !isValidMessageViewportElement(container)) return;
    runtime.viewportMeasurementsInvalid = false;
    resetMessageVirtualizerMeasurements(runtime);
    // Viewport restore is equivalent to activating/resuming the panel: rebuild stale measurements, then return to the end.
    requestMessageVirtualizerEndLock(runtime, { notify: true });
  });
}

function cancelViewportRestoreMessageVirtualizerReset(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFrame(runtime, "viewportRestoreFrame");
}

function scrollMessageVirtualizerByTextLines(runtime: MessageVirtualizerRuntime, direction: MessageScrollDirection): void {
  const container = runtime.container;
  if (!container) return;
  const delta = Math.max(1, Math.round(textLineHeight(container) * 2)) * direction;
  scrollMessageVirtualizerBy(runtime, delta);
}

function scrollMessageVirtualizerByPage(runtime: MessageVirtualizerRuntime, direction: MessageScrollDirection): void {
  const container = runtime.container;
  if (!container) return;
  const delta = Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
  scrollMessageVirtualizerBy(runtime, delta);
}

function disposeMessageVirtualizer(runtime: MessageVirtualizerRuntime): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelPendingMessageVirtualizerReconcile(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  runtime.pendingLayoutReconcile = null;
  runtime.onVirtualizerChange = null;
  resetMessageVirtualizerScrollLock(runtime);
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScroll = "idle";
}

function attachMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  if (runtime.container === container) return;

  detachMessageVirtualizer(runtime);
  resetMessageVirtualizer(runtime, container);
}

function detachMessageVirtualizer(runtime: MessageVirtualizerRuntime): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelPendingMessageVirtualizerReconcile(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  resetMessageVirtualizerScrollLock(runtime);
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScroll = "idle";
  runtime.pendingLayoutReconcile = null;
}

function resetMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = container;
  resetMessageVirtualizerScrollLock(runtime);
  runtime.virtualizer = new Virtualizer(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
  runtime.cleanupVirtualizer = mountMessageVirtualizer(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
}

function messageVirtualizerOptions(runtime: MessageVirtualizerRuntime): VirtualizerOptions<HTMLElement, HTMLElement> {
  const paddingBlock = messageBlockPadding(runtime.container);
  return {
    count: runtime.blocks.length,
    getScrollElement: () => runtime.container,
    estimateSize: () => MESSAGE_BLOCK_ESTIMATE_SIZE,
    initialRect: scrollElementRect(runtime.container),
    initialOffset: () => runtime.container?.scrollTop ?? 0,
    getItemKey: (index: number) => runtime.blocks[index]?.key ?? index,
    anchorTo: hasMessageVirtualizerEndLock(runtime) ? ("end" as const) : ("start" as const),
    followOnAppend: false,
    scrollEndThreshold: MESSAGE_BOTTOM_THRESHOLD,
    paddingStart: paddingBlock,
    paddingEnd: paddingBlock,
    overscan: 8,
    observeElementRect: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (rect: { width: number; height: number }) => void) =>
      observeMessageVirtualizerElementRect(runtime, instance, callback),
    observeElementOffset: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (offset: number, isScrolling: boolean) => void) =>
      observeMessageVirtualizerElementOffset(runtime, instance, callback),
    scrollToFn: (offset, options, instance) => {
      scrollMessageVirtualizerElement(runtime, offset, options, instance);
    },
    measureElement: (element: HTMLElement, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLElement, HTMLElement>) =>
      measureMessageElement(runtime, element, entry, instance),
    onChange: (_instance: Virtualizer<HTMLElement, HTMLElement>, sync: boolean) => {
      if (sync) {
        notifyMessageVirtualizerChange(runtime);
      } else {
        scheduleDeferredMessageVirtualizerChange(runtime);
      }
    },
  };
}

function observeMessageVirtualizerElementRect(
  runtime: MessageVirtualizerRuntime,
  instance: Virtualizer<HTMLElement, HTMLElement>,
  callback: (rect: { width: number; height: number }) => void,
): ReturnType<typeof observeElementRect> {
  return observeElementRect(instance, (rect) => {
    handleMessageVirtualizerViewportRect(runtime, rect, { notify: true });
    callback(rect);
  });
}

function observeMessageVirtualizerElementOffset(
  runtime: MessageVirtualizerRuntime,
  instance: Virtualizer<HTMLElement, HTMLElement>,
  callback: (offset: number, isScrolling: boolean) => void,
): ReturnType<typeof observeElementOffset> {
  return observeElementOffset(instance, (offset, isScrolling) => {
    callback(offset, isScrolling);
    handleMessageVirtualizerObservedOffset(runtime, instance, offset, isScrolling);
  });
}

function handleMessageVirtualizerObservedOffset(
  runtime: MessageVirtualizerRuntime,
  instance: Virtualizer<HTMLElement, HTMLElement>,
  offset: number,
  isScrolling: boolean,
): void {
  const element = instance.scrollElement;
  if (!element) return;
  const userIntendedScroll = observeMessageVirtualizerUserScroll(runtime, isScrolling);
  if (isMessageVirtualizerObservedOffsetAtEnd(runtime, instance, element, offset)) {
    setMessageVirtualizerEndLock(runtime);
    return;
  }
  if (!userIntendedScroll) return;
  setMessageVirtualizerAnchorLock(runtime, captureMessageVirtualizerReadingAnchorValue(runtime));
  cancelPendingMessageVirtualizerReconcile(runtime);
}

function updateMessageVirtualizerOptions(runtime: MessageVirtualizerRuntime): void {
  runtime.virtualizer.setOptions(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
}

function notifyMessageVirtualizerChange(runtime: MessageVirtualizerRuntime): void {
  cancelDeferredMessageVirtualizerChange(runtime);
  runtime.onVirtualizerChange?.();
}

function scheduleDeferredMessageVirtualizerChange(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) {
    notifyMessageVirtualizerChange(runtime);
    return;
  }
  if (runtime.virtualizerChangeFrame !== null) return;
  scheduleMessageVirtualizerFrame(runtime, "virtualizerChangeFrame", container, () => {
    if (runtime.container !== container) return;
    notifyMessageVirtualizerChange(runtime);
  });
}

function cancelDeferredMessageVirtualizerChange(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFrame(runtime, "virtualizerChangeFrame");
}

function configureMessageVirtualizerSizeAdjustment(runtime: MessageVirtualizerRuntime): void {
  // TanStack Virtual exposes this as an instance field rather than a normal option in v3.17.
  runtime.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
}

function scrollMessageVirtualizerElement(
  runtime: MessageVirtualizerRuntime,
  offset: number,
  options: Parameters<VirtualizerOptions<HTMLElement, HTMLElement>["scrollToFn"]>[1],
  instance: Virtualizer<HTMLElement, HTMLElement>,
): void {
  elementScroll(offset, options, instance);
}

function scrollMessageVirtualizerBy(runtime: MessageVirtualizerRuntime, delta: number): void {
  const container = runtime.container;
  if (!container) return;
  syncMessageVirtualizerScrollOffset(runtime);
  const currentScrollSize = Math.max(container.scrollHeight, runtime.virtualizer.getTotalSize());
  const currentScrollEnd = Math.max(0, currentScrollSize - container.clientHeight);
  const targetOffset = Math.max(0, Math.min(container.scrollTop + delta, currentScrollEnd));
  const targetAtEnd = delta > 0 && currentScrollEnd - targetOffset <= MESSAGE_BOTTOM_THRESHOLD;
  if (Math.abs(container.scrollTop - targetOffset) <= 1) {
    if (targetAtEnd) setMessageVirtualizerEndLock(runtime);
    return;
  }

  clearMessageVirtualizerEndLock(runtime);
  cancelPendingMessageVirtualizerReconcile(runtime);
  runtime.virtualizer.scrollToOffset(targetOffset);
  syncMessageVirtualizerScrollOffset(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  notifyMessageVirtualizerChange(runtime);
  if (targetAtEnd) {
    setMessageVirtualizerEndLock(runtime);
  } else {
    setMessageVirtualizerAnchorLock(runtime, captureMessageVirtualizerReadingAnchorValue(runtime));
  }
}

function hasMessageVirtualizerEndLock(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.scrollLock.kind === "end";
}

function isMessageVirtualizerAnchorLocked(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.scrollLock.kind === "anchor";
}

function requestMessageVirtualizerEndLock(
  runtime: MessageVirtualizerRuntime,
  options: { notify?: boolean; requireSettleFrame?: boolean } = {},
): void {
  setMessageVirtualizerEndLock(runtime);
  requestMessageVirtualizerLayoutReconcile(runtime, options);
}

function requestMessageVirtualizerLayoutReconcile(
  runtime: MessageVirtualizerRuntime,
  options: { notify?: boolean; requireSettleFrame?: boolean; scheduleSettle?: boolean; clampAnchorToEnd?: boolean } = {},
): void {
  runtime.pendingLayoutReconcile = mergeMessageVirtualizerLayoutReconcileRequest(runtime.pendingLayoutReconcile, options);
  if (options.notify) notifyMessageVirtualizerChange(runtime);
}

function mergeMessageVirtualizerLayoutReconcileRequest(
  current: MessageVirtualizerLayoutReconcileRequest | null,
  options: { requireSettleFrame?: boolean; scheduleSettle?: boolean; clampAnchorToEnd?: boolean },
): MessageVirtualizerLayoutReconcileRequest {
  return {
    requireSettleFrame: current?.requireSettleFrame === true || options.requireSettleFrame === true,
    scheduleSettle: (current?.scheduleSettle ?? true) && options.scheduleSettle !== false,
    clampAnchorToEnd: current?.clampAnchorToEnd === true || options.clampAnchorToEnd === true,
  };
}

function reconcileMessageVirtualizerLayout(runtime: MessageVirtualizerRuntime, request: MessageVirtualizerLayoutReconcileRequest): void {
  if (!runtime.container) return;
  if (runtime.scrollLock.kind === "end") {
    reconcileMessageVirtualizerEndLock(runtime, request);
    return;
  }
  if (runtime.scrollLock.kind === "anchor") {
    reconcileMessageVirtualizerAnchorLock(runtime, { clampToEnd: request.clampAnchorToEnd });
  }
}

function reconcileMessageVirtualizerEndLock(
  runtime: MessageVirtualizerRuntime,
  options: { requireSettleFrame?: boolean; scheduleSettle?: boolean } = {},
): void {
  runtime.virtualizer.getTotalSize();
  runtime.virtualizer.scrollToEnd();
  reconcileMessageVirtualizerDomEnd(runtime);
  if (options.scheduleSettle !== false) {
    scheduleSettledMessageVirtualizerScrollToEnd(
      runtime,
      options.requireSettleFrame === undefined ? {} : { requireSettleFrame: options.requireSettleFrame },
    );
  }
}

function scheduleSettledMessageVirtualizerScrollToEnd(
  runtime: MessageVirtualizerRuntime,
  options: { requireSettleFrame?: boolean } = {},
): void {
  const container = runtime.container;
  if (!container) return;
  if (options.requireSettleFrame !== true && !shouldSettleMessageVirtualizerScrollToEnd(runtime, container)) {
    cancelSettledMessageVirtualizerScrollToEnd(runtime);
    return;
  }
  // scrollToEnd can be clamped before the virtualizer height reaches the DOM; keep a bounded post-render settle.
  runtime.settleScrollToEndAttemptsRemaining = MESSAGE_SCROLL_TO_END_SETTLE_ATTEMPTS;
  if (runtime.settleScrollToEndFrame !== null) return;
  scheduleSettledMessageVirtualizerScrollToEndFrame(runtime, container, 2);
}

function shouldSettleMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime, container: HTMLElement): boolean {
  if (!isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD)) return true;
  // Hidden/resumed panes can start with rendered blocks but no scroll range yet; give the DOM a few frames to expose it.
  return runtime.blocks.length > 0 && container.scrollHeight <= container.clientHeight;
}

function scheduleSettledMessageVirtualizerScrollToEndFrame(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  delayFrames: number,
): void {
  scheduleMessageVirtualizerFrame(runtime, "settleScrollToEndFrame", container, () => {
    if (runtime.container !== container) {
      runtime.settleScrollToEndAttemptsRemaining = 0;
      return;
    }
    if (delayFrames > 1) {
      scheduleSettledMessageVirtualizerScrollToEndFrame(runtime, container, delayFrames - 1);
      return;
    }
    if (!hasMessageVirtualizerEndLock(runtime)) {
      runtime.settleScrollToEndAttemptsRemaining = 0;
      return;
    }
    runtime.settleScrollToEndAttemptsRemaining = Math.max(0, runtime.settleScrollToEndAttemptsRemaining - 1);
    requestMessageVirtualizerLayoutReconcile(runtime, { notify: true, scheduleSettle: false });
    if (
      runtime.settleScrollToEndAttemptsRemaining > 0 &&
      !isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD)
    ) {
      scheduleSettledMessageVirtualizerScrollToEndFrame(runtime, container, 1);
    }
  });
}

function reconcileMessageVirtualizerDomEnd(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) return;
  const domEnd = Math.max(0, container.scrollHeight - container.clientHeight);
  if (domEnd > container.scrollTop) container.scrollTop = domEnd;
}

function cancelSettledMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFrame(runtime, "settleScrollToEndFrame");
  runtime.settleScrollToEndAttemptsRemaining = 0;
}

function scheduleMessageVirtualizerFrame(
  runtime: MessageVirtualizerRuntime,
  key: MessageVirtualizerFrameKey,
  container: HTMLElement,
  callback: () => void,
): void {
  runtime[key] = container.win.requestAnimationFrame(() => {
    runtime[key] = null;
    callback();
  });
}

function cancelMessageVirtualizerFrame(runtime: MessageVirtualizerRuntime, key: MessageVirtualizerFrameKey): void {
  const container = runtime.container;
  const frame = runtime[key];
  if (container && frame !== null) {
    container.win.cancelAnimationFrame(frame);
  }
  runtime[key] = null;
}

function messageBlockPadding(element: HTMLElement | null): number {
  if (!element) return 0;
  const win = element.ownerDocument.defaultView;
  if (!win) return 0;
  const value = Number.parseFloat(win.getComputedStyle(element).paddingLeft);
  return Number.isFinite(value) ? value : 0;
}

function scrollElementRect(element: HTMLElement | null): { width: number; height: number } {
  return {
    width: nonZeroDimension(element?.clientWidth, 240),
    height: nonZeroDimension(element?.clientHeight, 320),
  };
}

function handleMessageVirtualizerViewportElement(runtime: MessageVirtualizerRuntime, element: HTMLElement): void {
  // ResizeObserver can miss the hidden-at-start case; render entry also checks the live viewport dimensions.
  handleMessageVirtualizerViewportRect(runtime, { width: element.clientWidth, height: element.clientHeight });
}

function isInvalidMessageViewportRect(rect: { width: number; height: number }): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

function isValidMessageViewportElement(element: HTMLElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0;
}

function nonZeroDimension(value: number | undefined, fallback: number): number {
  return value === undefined || value === 0 ? fallback : value;
}

function isElementAtEnd(element: HTMLElement, fallbackScrollSize: number, threshold: number): boolean {
  const scrollSize = Math.max(element.scrollHeight, fallbackScrollSize);
  return scrollSize - element.clientHeight - element.scrollTop <= threshold;
}

function isMessageVirtualizerObservedOffsetAtEnd(
  runtime: MessageVirtualizerRuntime,
  instance: Virtualizer<HTMLElement, HTMLElement>,
  element: HTMLElement,
  offset: number,
): boolean {
  return isScrollOffsetAtEnd(offset, element.clientHeight, instance.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD);
}

function isScrollOffsetAtEnd(offset: number, viewportSize: number, totalSize: number, threshold: number): boolean {
  return totalSize - viewportSize - offset <= threshold;
}

function markMessageVirtualizerUserScrollIntent(runtime: MessageVirtualizerRuntime): void {
  runtime.userScroll = "pending";
}

function observeMessageVirtualizerUserScroll(runtime: MessageVirtualizerRuntime, isScrolling: boolean): boolean {
  if (runtime.userScroll === "idle") return false;
  runtime.userScroll = isScrolling ? "active" : "idle";
  return true;
}

function measureMessageElement(
  runtime: MessageVirtualizerRuntime,
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): number {
  const box = entry?.borderBoxSize[0];
  const size = box ? Math.round(box.blockSize) : element.offsetHeight || instance.options.estimateSize(instance.indexFromElement(element));
  if (entry) {
    requestMessageVirtualizerLayoutReconcile(runtime, {
      clampAnchorToEnd: isMessageVirtualizerAnchorLocked(runtime),
      notify: true,
      requireSettleFrame: hasMessageVirtualizerEndLock(runtime),
    });
  }
  return size;
}

function captureMessageVirtualizerReadingAnchorValue(runtime: MessageVirtualizerRuntime): MessageVirtualizerReadingAnchor | null {
  const container = runtime.container;
  if (!container) return null;
  const scrollOffset = container.scrollTop;
  const anchor = runtime.virtualizer.getVirtualItems().find((item) => item.end > scrollOffset);
  return anchor ? { key: anchor.key, top: anchor.start - scrollOffset } : null;
}

function reconcileMessageVirtualizerAnchorLock(runtime: MessageVirtualizerRuntime, options: { clampToEnd?: boolean } = {}): void {
  const container = runtime.container;
  const lock = runtime.scrollLock;
  if (!container || lock.kind !== "anchor" || !lock.anchor) return;
  const anchor = lock.anchor;

  const item = runtime.virtualizer.getVirtualItems().find((candidate) => Object.is(candidate.key, anchor.key));
  if (!item) return;

  const scrollSize = Math.max(container.scrollHeight, runtime.virtualizer.getTotalSize());
  const scrollEnd = Math.max(0, scrollSize - container.clientHeight);
  const targetOffset = Math.max(0, Math.min(item.start - anchor.top, scrollEnd));
  if (Math.abs(container.scrollTop - targetOffset) > 1) {
    runtime.virtualizer.scrollToOffset(targetOffset);
    syncMessageVirtualizerScrollOffset(runtime);
    updateMessageVirtualizer(runtime.virtualizer);
    notifyMessageVirtualizerChange(runtime);
  }
  if (options.clampToEnd) clampMessageVirtualizerAnchorOffsetToEnd(runtime);
}

function clampMessageVirtualizerAnchorOffsetToEnd(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container || !isMessageVirtualizerAnchorLocked(runtime)) return;
  const rawTotalSize = runtime.virtualizer.getTotalSize();
  if (container.scrollHeight <= getMessageVirtualizerTotalSize(runtime) + MESSAGE_BOTTOM_THRESHOLD) return;
  const rawScrollEnd = Math.max(0, rawTotalSize - container.clientHeight);
  if (container.scrollTop <= rawScrollEnd) return;
  runtime.virtualizer.scrollToOffset(rawScrollEnd);
  syncMessageVirtualizerScrollOffset(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  setMessageVirtualizerEndLock(runtime);
  notifyMessageVirtualizerChange(runtime);
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}

function mountMessageVirtualizer(runtime: MessageVirtualizerRuntime): () => void {
  // Match the official TanStack framework adapters: create the core instance in userland, then call _didMount from the hook.
  const cleanupVirtualizer = runtime.virtualizer._didMount();
  const cleanupUserScrollTracking = mountMessageVirtualizerUserScrollTracking(runtime);
  return () => {
    cleanupUserScrollTracking();
    cleanupVirtualizer();
  };
}

function updateMessageVirtualizer(virtualizer: Virtualizer<HTMLElement, HTMLElement>): void {
  // Same adapter pattern as TanStack's React/Solid/etc. bindings; this is the Preact-local _willUpdate boundary.
  virtualizer._willUpdate();
}

function mountMessageVirtualizerUserScrollTracking(runtime: MessageVirtualizerRuntime): () => void {
  const container = runtime.container;
  if (!container) {
    return () => {
      // No scroll element is attached yet.
    };
  }
  const markUserScrollIntent = () => {
    markMessageVirtualizerUserScrollIntent(runtime);
  };
  const markKeyboardScrollIntent = (event: KeyboardEvent) => {
    if (isKeyboardScrollEvent(event)) markUserScrollIntent();
  };
  const markDocumentKeyboardScrollIntent = (event: KeyboardEvent) => {
    if (isDocumentKeyboardScrollEventForMessageViewport(event, container)) markUserScrollIntent();
  };
  container.addEventListener("wheel", markUserScrollIntent, { passive: true });
  container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
  container.addEventListener("pointerdown", markUserScrollIntent);
  container.addEventListener("mousedown", markUserScrollIntent);
  container.addEventListener("keydown", markKeyboardScrollIntent);
  container.ownerDocument.addEventListener("keydown", markDocumentKeyboardScrollIntent, true);
  return () => {
    container.removeEventListener("wheel", markUserScrollIntent);
    container.removeEventListener("touchstart", markUserScrollIntent);
    container.removeEventListener("pointerdown", markUserScrollIntent);
    container.removeEventListener("mousedown", markUserScrollIntent);
    container.removeEventListener("keydown", markKeyboardScrollIntent);
    container.ownerDocument.removeEventListener("keydown", markDocumentKeyboardScrollIntent, true);
  };
}

function isDocumentKeyboardScrollEventForMessageViewport(event: KeyboardEvent, container: HTMLElement): boolean {
  if (!isKeyboardScrollEvent(event)) return false;
  const target = event.target;
  const document = container.ownerDocument;
  return target === document.body || target === document.documentElement;
}

function isKeyboardScrollEvent(event: KeyboardEvent): boolean {
  return (
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "PageUp" ||
    event.key === "PageDown" ||
    event.key === "Home" ||
    event.key === "End" ||
    event.key === " "
  );
}
