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

export type MessageStreamScrollIntent = "auto" | "force-bottom" | "follow-bottom" | "preserve";
type MessageScrollDirection = -1 | 1;

interface MessageVirtualizerReadingAnchor {
  key: unknown;
  top: number;
}

type MessageVirtualizerScrollMode =
  | { kind: "free" }
  | { kind: "follow-end" }
  | { kind: "preserve-anchor"; anchor: MessageVirtualizerReadingAnchor | null };

const MESSAGE_BOTTOM_THRESHOLD = 4;
const MESSAGE_BLOCK_ESTIMATE_SIZE = 96;
const MESSAGE_SCROLL_TO_END_SETTLE_ATTEMPTS = 4;
const MESSAGE_USER_SCROLL_INTENT_WINDOW_MS = 1000;
export interface MessageStreamVirtualizerHandle {
  scrollByTextLines(direction: MessageScrollDirection): void;
  scrollByPage(direction: MessageScrollDirection): void;
  pinToBottom(): void;
  repinToBottomIfPinned(): void;
}

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
  pendingBottomReconcileAfterCommit: boolean;
  onVirtualizerChange: (() => void) | null;
  scrollMode: MessageVirtualizerScrollMode;
  viewportMeasurementsInvalid: boolean;
  viewportRestoreFrame: number | null;
  virtualizerChangeFrame: number | null;
  settleScrollToEndFrame: number | null;
  anchorClampFrame: number | null;
  settleScrollToEndAttemptsRemaining: number;
  userScrollIntentUntil: number;
}

type MessageVirtualizerFrameKey = "viewportRestoreFrame" | "virtualizerChangeFrame" | "settleScrollToEndFrame" | "anchorClampFrame";

export interface MessageStreamVirtualizerOptions {
  blocks: readonly MessageStreamBlock[];
  consumeScrollIntent: () => MessageStreamScrollIntent;
  registerVirtualizer: ((virtualizer: MessageStreamVirtualizerHandle) => () => void) | undefined;
  scrollElementRef: { current: HTMLElement | null };
}

export function useMessageStreamVirtualizer({
  blocks,
  consumeScrollIntent,
  registerVirtualizer,
  scrollElementRef,
}: MessageStreamVirtualizerOptions): MessageStreamVirtualizerView {
  const runtimeRef = useRef<MessageVirtualizerRuntime | null>(null);
  const consumeScrollIntentRef = useRef(consumeScrollIntent);
  consumeScrollIntentRef.current = consumeScrollIntent;
  runtimeRef.current ??= createMessageVirtualizerRuntime();
  const runtime = runtimeRef.current;
  const virtualizerHandle = useMemo<MessageStreamVirtualizerHandle>(
    () => ({
      scrollByTextLines(direction) {
        if (runtimeRef.current) scrollMessageVirtualizerByTextLines(runtimeRef.current, direction);
      },
      scrollByPage(direction) {
        if (runtimeRef.current) scrollMessageVirtualizerByPage(runtimeRef.current, direction);
      },
      pinToBottom() {
        if (runtimeRef.current) pinMessageVirtualizerToBottom(runtimeRef.current);
      },
      repinToBottomIfPinned() {
        if (runtimeRef.current) repinMessageVirtualizerToBottomIfPinned(runtimeRef.current);
      },
    }),
    [],
  );
  const [, setVersion] = useState(0);

  useLayoutEffect(() => {
    const unregister = registerVirtualizer?.(virtualizerHandle);
    return () => {
      unregister?.();
    };
  }, [registerVirtualizer, virtualizerHandle]);

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
    // Run before the render effect below: bottom requests made during one commit are reconciled after the DOM for the next commit exists.
    reconcileMessageVirtualizerBottomAfterCommit(runtime);
  });

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;
    renderMessageVirtualizer(runtime, scrollElement, consumeScrollIntentRef.current(), blocks);
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
    pendingBottomReconcileAfterCommit: false,
    onVirtualizerChange: null,
    scrollMode: { kind: "free" },
    viewportMeasurementsInvalid: false,
    viewportRestoreFrame: null,
    virtualizerChangeFrame: null,
    settleScrollToEndFrame: null,
    anchorClampFrame: null,
    settleScrollToEndAttemptsRemaining: 0,
    userScrollIntentUntil: 0,
  };
  runtime.virtualizer = new Virtualizer(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
  return runtime;
}

function renderMessageVirtualizer(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  intent: MessageStreamScrollIntent,
  blocks: readonly MessageStreamBlock[],
): void {
  attachMessageVirtualizer(runtime, container);
  handleMessageVirtualizerViewportElement(runtime, container);

  const appendingBlocks = blocks.length > runtime.blocks.length;
  const shouldFollowAppend =
    intent === "auto" &&
    appendingBlocks &&
    (hasMessageVirtualizerFollowEndIntent(runtime) || isMessageVirtualizerObservedAtEnd(runtime, container));
  runtime.blocks = blocks;
  const shouldScrollToBottom = blocks.length > 0 && (intent === "force-bottom" || intent === "follow-bottom" || shouldFollowAppend);
  if (intent === "preserve") {
    clearMessageVirtualizerFollowEndIntent(runtime);
    cancelPendingMessageVirtualizerBottomFollow(runtime);
  }
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);

  if (shouldScrollToBottom) {
    requestMessageVirtualizerScrollToEnd(runtime);
    return;
  }
}

function getMessageVirtualizerTotalSize(runtime: MessageVirtualizerRuntime): number {
  const totalSize = runtime.virtualizer.getTotalSize();
  const container = runtime.container;
  if (!container || !isMessageVirtualizerPreservingReadingAnchor(runtime)) return totalSize;
  return Math.max(totalSize, container.scrollTop + container.clientHeight + MESSAGE_BOTTOM_THRESHOLD + 1);
}

function getMessageVirtualizerItems(runtime: MessageVirtualizerRuntime): VirtualItem[] {
  return runtime.virtualizer.getVirtualItems();
}

function measureMessageVirtualizerElement(runtime: MessageVirtualizerRuntime, element: HTMLElement | null): void {
  const shouldSettleAtEnd = prepareMessageVirtualizerMeasurement(runtime);
  runtime.virtualizer.measureElement(element);
  restoreMessageVirtualizerReadingAnchor(runtime);
  if (element && shouldSettleAtEnd) requestMessageVirtualizerScrollToEnd(runtime, { requireSettleFrame: true });
}

function prepareMessageVirtualizerMeasurement(runtime: MessageVirtualizerRuntime): boolean {
  const wasFollowingEnd = hasMessageVirtualizerFollowEndIntent(runtime);
  const scrollOffsetMovedAwayFromEnd = syncMessageVirtualizerScrollOffset(runtime);
  return hasMessageVirtualizerFollowEndIntent(runtime) || (wasFollowingEnd && !scrollOffsetMovedAwayFromEnd);
}

function reconcileMessageVirtualizerBottomAfterCommit(runtime: MessageVirtualizerRuntime): void {
  if (!runtime.pendingBottomReconcileAfterCommit) return;
  runtime.pendingBottomReconcileAfterCommit = false;
  if (!runtime.container || !hasMessageVirtualizerFollowEndIntent(runtime)) return;
  runtime.virtualizer.getTotalSize();
  runtime.virtualizer.scrollToEnd();
  reconcileMessageVirtualizerDomEnd(runtime);
  scheduleSettledMessageVirtualizerScrollToEnd(runtime);
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
  if (hasMessageVirtualizerFollowEndIntent(runtime) && hasPendingMessageVirtualizerScrollToEnd(runtime)) return false;
  const offset = container.scrollTop;
  const previousOffset = runtime.virtualizer.scrollOffset;
  const offsetChanged = previousOffset !== null && offset !== previousOffset;
  if (previousOffset !== null && offset !== previousOffset) {
    runtime.virtualizer.scrollDirection = offset < previousOffset ? "backward" : "forward";
  }
  runtime.virtualizer.scrollOffset = offset;
  const scrollOffsetMovedAwayFromEnd = messageVirtualizerScrollOffsetMovedAwayFromEnd(runtime, container, offsetChanged);
  if (scrollOffsetMovedAwayFromEnd) {
    markMessageVirtualizerReadingAnchorIntent(runtime);
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

function markMessageVirtualizerFollowEndIntent(runtime: MessageVirtualizerRuntime): void {
  runtime.scrollMode = { kind: "follow-end" };
  updateMessageVirtualizerOptions(runtime);
}

function clearMessageVirtualizerFollowEndIntent(runtime: MessageVirtualizerRuntime): void {
  if (runtime.scrollMode.kind === "follow-end") runtime.scrollMode = { kind: "free" };
}

function markMessageVirtualizerReadingAnchorIntent(runtime: MessageVirtualizerRuntime): void {
  if (runtime.scrollMode.kind !== "preserve-anchor") {
    runtime.scrollMode = { kind: "preserve-anchor", anchor: null };
  }
  updateMessageVirtualizerOptions(runtime);
}

function resetMessageVirtualizerScrollIntent(runtime: MessageVirtualizerRuntime): void {
  runtime.scrollMode = { kind: "free" };
  updateMessageVirtualizerOptions(runtime);
}

function cancelPendingMessageVirtualizerBottomFollow(runtime: MessageVirtualizerRuntime): void {
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.pendingBottomReconcileAfterCommit = false;
}

function setMessageVirtualizerChangeHandler(runtime: MessageVirtualizerRuntime, callback: (() => void) | null): void {
  runtime.onVirtualizerChange = callback;
}

function pinMessageVirtualizerToBottom(runtime: MessageVirtualizerRuntime, container = runtime.container): void {
  if (!container) return;
  attachMessageVirtualizer(runtime, container);
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  requestMessageVirtualizerScrollToEnd(runtime);
}

function repinMessageVirtualizerToBottomIfPinned(runtime: MessageVirtualizerRuntime): void {
  if (!hasMessageVirtualizerFollowEndIntent(runtime)) return;
  requestMessageVirtualizerScrollToEnd(runtime);
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

function handleMessageVirtualizerViewportRect(runtime: MessageVirtualizerRuntime, rect: { width: number; height: number }): void {
  if (isInvalidMessageViewportRect(rect)) {
    runtime.viewportMeasurementsInvalid = true;
    cancelViewportRestoreMessageVirtualizerReset(runtime);
    return;
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
    requestMessageVirtualizerScrollToEnd(runtime);
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
  cancelPreservedMessageVirtualizerEndClamp(runtime);
  cancelPendingMessageVirtualizerBottomFollow(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  runtime.pendingBottomReconcileAfterCommit = false;
  runtime.onVirtualizerChange = null;
  resetMessageVirtualizerScrollIntent(runtime);
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScrollIntentUntil = 0;
}

function attachMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  if (runtime.container === container) return;

  detachMessageVirtualizer(runtime);
  resetMessageVirtualizer(runtime, container);
}

function detachMessageVirtualizer(runtime: MessageVirtualizerRuntime): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelPreservedMessageVirtualizerEndClamp(runtime);
  cancelPendingMessageVirtualizerBottomFollow(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  resetMessageVirtualizerScrollIntent(runtime);
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScrollIntentUntil = 0;
}

function resetMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelPreservedMessageVirtualizerEndClamp(runtime);
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = container;
  resetMessageVirtualizerScrollIntent(runtime);
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
    anchorTo: hasMessageVirtualizerFollowEndIntent(runtime) ? ("end" as const) : ("start" as const),
    followOnAppend: true,
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
    handleMessageVirtualizerViewportRect(runtime, rect);
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
    handleMessageVirtualizerObservedOffset(runtime, instance, offset);
  });
}

function handleMessageVirtualizerObservedOffset(
  runtime: MessageVirtualizerRuntime,
  instance: Virtualizer<HTMLElement, HTMLElement>,
  offset: number,
): void {
  const element = instance.scrollElement;
  if (!element) return;
  if (isMessageVirtualizerObservedOffsetAtEnd(runtime, instance, element, offset)) {
    if (isMessageVirtualizerPreservingReadingAnchor(runtime) && instance.scrollDirection === "backward") return;
    markMessageVirtualizerFollowEndIntent(runtime);
    return;
  }
  if (!userIntendedMessageVirtualizerScroll(runtime, element)) return;
  markMessageVirtualizerReadingAnchorIntent(runtime);
  cancelPendingMessageVirtualizerBottomFollow(runtime);
  captureMessageVirtualizerReadingAnchor(runtime);
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
  runtime.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    shouldAdjustMessageScrollPositionOnItemSizeChange(runtime, item, delta, instance);
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
    if (targetAtEnd) markMessageVirtualizerFollowEndIntent(runtime);
    return;
  }

  clearMessageVirtualizerFollowEndIntent(runtime);
  cancelPendingMessageVirtualizerBottomFollow(runtime);
  markMessageVirtualizerReadingAnchorIntent(runtime);
  runtime.virtualizer.scrollToOffset(targetOffset);
  syncMessageVirtualizerScrollOffset(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  notifyMessageVirtualizerChange(runtime);
  if (targetAtEnd) {
    markMessageVirtualizerFollowEndIntent(runtime);
  } else {
    captureMessageVirtualizerReadingAnchor(runtime);
  }
}

function hasMessageVirtualizerFollowEndIntent(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.scrollMode.kind === "follow-end";
}

function isMessageVirtualizerPreservingReadingAnchor(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.scrollMode.kind === "preserve-anchor";
}

function requestMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime, options: { requireSettleFrame?: boolean } = {}): void {
  markMessageVirtualizerFollowEndIntent(runtime);
  runtime.virtualizer.getTotalSize();
  runtime.virtualizer.scrollToEnd();
  reconcileMessageVirtualizerDomEnd(runtime);
  scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime);
  scheduleSettledMessageVirtualizerScrollToEnd(runtime, options);
}

function scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime: MessageVirtualizerRuntime): void {
  runtime.pendingBottomReconcileAfterCommit = true;
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
    if (!hasMessageVirtualizerFollowEndIntent(runtime)) {
      runtime.settleScrollToEndAttemptsRemaining = 0;
      return;
    }
    const totalSize = runtime.virtualizer.getTotalSize();
    runtime.virtualizer.scrollToEnd();
    reconcileMessageVirtualizerDomEnd(runtime);
    runtime.settleScrollToEndAttemptsRemaining = Math.max(0, runtime.settleScrollToEndAttemptsRemaining - 1);
    if (runtime.settleScrollToEndAttemptsRemaining > 0 && !isElementAtEnd(container, totalSize, MESSAGE_BOTTOM_THRESHOLD)) {
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

function schedulePreservedMessageVirtualizerEndClamp(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container || runtime.anchorClampFrame !== null) return;
  scheduleMessageVirtualizerFrame(runtime, "anchorClampFrame", container, () => {
    if (runtime.container !== container || !isMessageVirtualizerPreservingReadingAnchor(runtime)) return;
    const scrollEnd = Math.max(0, runtime.virtualizer.getTotalSize() - container.clientHeight);
    if (Math.abs(container.scrollTop - scrollEnd) <= MESSAGE_BOTTOM_THRESHOLD) {
      updateMessageVirtualizer(runtime.virtualizer);
      markMessageVirtualizerFollowEndIntent(runtime);
      notifyMessageVirtualizerChange(runtime);
      return;
    }
    if (container.scrollTop < scrollEnd) return;
    runtime.virtualizer.scrollToOffset(scrollEnd);
    syncMessageVirtualizerScrollOffset(runtime);
    updateMessageVirtualizer(runtime.virtualizer);
    markMessageVirtualizerFollowEndIntent(runtime);
    notifyMessageVirtualizerChange(runtime);
  });
}

function cancelPreservedMessageVirtualizerEndClamp(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFrame(runtime, "anchorClampFrame");
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

function markMessageVirtualizerUserScrollIntent(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  runtime.userScrollIntentUntil = container.win.performance.now() + MESSAGE_USER_SCROLL_INTENT_WINDOW_MS;
}

function userIntendedMessageVirtualizerScroll(runtime: MessageVirtualizerRuntime, container: HTMLElement): boolean {
  return container.win.performance.now() <= runtime.userScrollIntentUntil;
}

function measureMessageElement(
  runtime: MessageVirtualizerRuntime,
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): number {
  const box = entry?.borderBoxSize[0];
  const size = box ? Math.round(box.blockSize) : element.offsetHeight || instance.options.estimateSize(instance.indexFromElement(element));
  if (entry && isMessageVirtualizerPreservingReadingAnchor(runtime)) {
    schedulePreservedMessageVirtualizerEndClamp(runtime);
  }
  if (entry && hasMessageVirtualizerFollowEndIntent(runtime)) {
    // ResizeObserver measurements can arrive while TanStack and DOM heights are still converging, so keep the bounded settle.
    scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime);
    scheduleSettledMessageVirtualizerScrollToEnd(runtime, { requireSettleFrame: true });
  }
  return size;
}

function shouldAdjustMessageScrollPositionOnItemSizeChange(
  runtime: MessageVirtualizerRuntime,
  item: VirtualItem,
  delta: number,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): boolean {
  const scrollOffset = instance.scrollOffset ?? 0;
  if (!hasMessageVirtualizerFollowEndIntent(runtime)) {
    if (instance.scrollDirection === "backward") return false;
    return (
      isMessageVirtualizerPreservingReadingAnchor(runtime) && shouldPreserveMessageScrollAnchorOnItemSizeChange(item, delta, scrollOffset)
    );
  }
  if (runtime.container && !isMessageVirtualizerObservedAtEnd(runtime, runtime.container)) return false;
  return item.start < scrollOffset && instance.scrollDirection !== "backward";
}

function shouldPreserveMessageScrollAnchorOnItemSizeChange(item: VirtualItem, delta: number, scrollOffset: number): boolean {
  if (delta === 0) return false;
  const previousEnd = item.end - delta;
  return previousEnd <= scrollOffset;
}

function captureMessageVirtualizerReadingAnchor(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container || runtime.scrollMode.kind !== "preserve-anchor") {
    return;
  }
  const scrollOffset = container.scrollTop;
  const anchor = runtime.virtualizer.getVirtualItems().find((item) => item.end > scrollOffset);
  runtime.scrollMode = {
    kind: "preserve-anchor",
    anchor: anchor ? { key: anchor.key, top: anchor.start - scrollOffset } : null,
  };
}

function restoreMessageVirtualizerReadingAnchor(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  const mode = runtime.scrollMode;
  if (!container || mode.kind !== "preserve-anchor" || !mode.anchor) return;
  const anchor = mode.anchor;

  const item = runtime.virtualizer.getVirtualItems().find((candidate) => Object.is(candidate.key, anchor.key));
  if (!item) return;

  const scrollSize = Math.max(container.scrollHeight, runtime.virtualizer.getTotalSize());
  const scrollEnd = Math.max(0, scrollSize - container.clientHeight);
  const targetOffset = Math.max(0, Math.min(item.start - anchor.top, scrollEnd));
  if (Math.abs(container.scrollTop - targetOffset) <= 1) return;

  runtime.virtualizer.scrollToOffset(targetOffset);
  syncMessageVirtualizerScrollOffset(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
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
    markMessageVirtualizerUserScrollIntent(runtime, container);
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
