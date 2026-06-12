import { elementScroll, observeElementOffset, observeElementRect, Virtualizer, type VirtualItem } from "@tanstack/virtual-core";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type { MessageStreamBlock } from "./message-stream/context";

export type MessageStreamScrollIntent = "auto" | "force-bottom" | "follow-bottom" | "preserve";
type MessageScrollDirection = -1 | 1;

interface MessageVirtualizerRenderPlan {
  generation: number;
  shouldScrollToBottom: boolean;
}

interface MessageVirtualizerMeasurePlan {
  shouldSettleAtEnd: boolean;
}

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
  commitGeneration: number;
  bottomReconcileCommitGeneration: number | null;
  renderGeneration: number;
  onVirtualizerChange: (() => void) | null;
  followEndIntent: boolean;
  viewportMeasurementsInvalid: boolean;
  viewportRestoreFrame: number | null;
  settleScrollToEndFrame: number | null;
  settleScrollToEndAttemptsRemaining: number;
  userScrollIntentUntil: number;
}

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
    commitGeneration: 0,
    bottomReconcileCommitGeneration: null,
    renderGeneration: 0,
    onVirtualizerChange: null,
    followEndIntent: false,
    viewportMeasurementsInvalid: false,
    viewportRestoreFrame: null,
    settleScrollToEndFrame: null,
    settleScrollToEndAttemptsRemaining: 0,
    userScrollIntentUntil: 0,
  };
  runtime.virtualizer = new Virtualizer(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
  return runtime;
}

function prepareMessageVirtualizerRender(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  intent: MessageStreamScrollIntent,
  blocks: readonly MessageStreamBlock[],
): MessageVirtualizerRenderPlan {
  attachMessageVirtualizer(runtime, container);
  handleMessageVirtualizerViewportElement(runtime, container);

  const appendingBlocks = blocks.length > runtime.blocks.length;
  const shouldFollowAppend =
    intent === "auto" && appendingBlocks && (runtime.followEndIntent || isMessageVirtualizerObservedAtEnd(runtime, container));
  runtime.blocks = blocks;
  const shouldScrollToBottom = blocks.length > 0 && (intent === "force-bottom" || intent === "follow-bottom" || shouldFollowAppend);
  if (intent === "preserve") {
    runtime.followEndIntent = false;
    cancelSettledMessageVirtualizerScrollToEnd(runtime);
    runtime.bottomReconcileCommitGeneration = null;
  }
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);

  return {
    generation: ++runtime.renderGeneration,
    shouldScrollToBottom,
  };
}

function completeMessageVirtualizerRender(runtime: MessageVirtualizerRuntime, plan: MessageVirtualizerRenderPlan): void {
  if (plan.generation !== runtime.renderGeneration) return;

  updateMessageVirtualizer(runtime.virtualizer);
  if (plan.shouldScrollToBottom) {
    requestMessageVirtualizerScrollToEnd(runtime);
    return;
  }
}

function renderMessageVirtualizer(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  intent: MessageStreamScrollIntent,
  blocks: readonly MessageStreamBlock[],
): void {
  completeMessageVirtualizerRender(runtime, prepareMessageVirtualizerRender(runtime, container, intent, blocks));
}

function getMessageVirtualizerTotalSize(runtime: MessageVirtualizerRuntime): number {
  return runtime.virtualizer.getTotalSize();
}

function getMessageVirtualizerItems(runtime: MessageVirtualizerRuntime): VirtualItem[] {
  return runtime.virtualizer.getVirtualItems();
}

function measureMessageVirtualizerElement(runtime: MessageVirtualizerRuntime, element: HTMLElement | null): void {
  const plan = prepareMessageVirtualizerMeasurement(runtime);
  runtime.virtualizer.measureElement(element);
  if (element && plan.shouldSettleAtEnd) requestMessageVirtualizerScrollToEnd(runtime);
}

function prepareMessageVirtualizerMeasurement(runtime: MessageVirtualizerRuntime): MessageVirtualizerMeasurePlan {
  const wasFollowingEnd = hasMessageVirtualizerFollowEndIntent(runtime);
  const scrollOffsetMovedAwayFromEnd = syncMessageVirtualizerScrollOffset(runtime);
  return {
    shouldSettleAtEnd: hasMessageVirtualizerFollowEndIntent(runtime) || (wasFollowingEnd && !scrollOffsetMovedAwayFromEnd),
  };
}

function reconcileMessageVirtualizerBottomAfterCommit(runtime: MessageVirtualizerRuntime): void {
  runtime.commitGeneration += 1;
  const reconcileGeneration = runtime.bottomReconcileCommitGeneration;
  if (reconcileGeneration === null || reconcileGeneration > runtime.commitGeneration) return;
  runtime.bottomReconcileCommitGeneration = null;
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
    runtime.followEndIntent = false;
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
  if (!runtime.followEndIntent) return;
  requestMessageVirtualizerScrollToEnd(runtime);
}

function resetMessageVirtualizerMeasurements(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) return;
  // A hidden Obsidian pane can leave TanStack measurements stale while the message stream state is still valid.
  // Reset only the virtualizer runtime, then measure the still-rendered blocks.
  resetMessageVirtualizer(runtime, container);
  runtime.onVirtualizerChange?.();
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
  runtime.viewportRestoreFrame = container.win.requestAnimationFrame(() => {
    runtime.viewportRestoreFrame = null;
    if (runtime.container !== container || !isValidMessageViewportElement(container)) return;
    runtime.viewportMeasurementsInvalid = false;
    resetMessageVirtualizerMeasurements(runtime);
    // Viewport restore is equivalent to activating/resuming the panel: rebuild stale measurements, then return to the end.
    requestMessageVirtualizerScrollToEnd(runtime);
  });
}

function cancelViewportRestoreMessageVirtualizerReset(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (container && runtime.viewportRestoreFrame !== null) {
    container.win.cancelAnimationFrame(runtime.viewportRestoreFrame);
  }
  runtime.viewportRestoreFrame = null;
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
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  runtime.commitGeneration = 0;
  runtime.bottomReconcileCommitGeneration = null;
  runtime.renderGeneration = 0;
  runtime.onVirtualizerChange = null;
  runtime.followEndIntent = false;
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
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  runtime.bottomReconcileCommitGeneration = null;
  runtime.renderGeneration = 0;
  runtime.followEndIntent = false;
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScrollIntentUntil = 0;
}

function resetMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = container;
  runtime.followEndIntent = false;
  runtime.virtualizer = new Virtualizer(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
  runtime.cleanupVirtualizer = mountMessageVirtualizer(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
}

function messageVirtualizerOptions(runtime: MessageVirtualizerRuntime) {
  const paddingBlock = messageBlockPadding(runtime.container);
  return {
    count: runtime.blocks.length,
    getScrollElement: () => runtime.container,
    estimateSize: () => MESSAGE_BLOCK_ESTIMATE_SIZE,
    initialRect: scrollElementRect(runtime.container),
    initialOffset: () => runtime.container?.scrollTop ?? 0,
    getItemKey: (index: number) => runtime.blocks[index]?.key ?? index,
    anchorTo: "end" as const,
    followOnAppend: true,
    scrollEndThreshold: MESSAGE_BOTTOM_THRESHOLD,
    paddingStart: paddingBlock,
    paddingEnd: paddingBlock,
    // Obsidian/Electron can report ResizeObserver loop warnings during resume when message rendering mutates the DOM heavily.
    // Deferring measurement keeps those resume measurements from feeding back into the same observer delivery.
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
    observeElementRect: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (rect: { width: number; height: number }) => void) =>
      observeElementRect(instance, (rect) => {
        handleMessageVirtualizerViewportRect(runtime, rect);
        callback(rect);
      }),
    observeElementOffset: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (offset: number, isScrolling: boolean) => void) =>
      observeElementOffset(instance, (offset, isScrolling) => {
        callback(offset, isScrolling);
        const element = instance.scrollElement;
        if (element && isMessageVirtualizerObservedOffsetAtEnd(instance, element, offset)) {
          runtime.followEndIntent = true;
          return;
        }
        if (element && userIntendedMessageVirtualizerScroll(runtime, element)) {
          runtime.followEndIntent = false;
          cancelSettledMessageVirtualizerScrollToEnd(runtime);
          runtime.bottomReconcileCommitGeneration = null;
        }
      }),
    scrollToFn: elementScroll,
    measureElement: (element: HTMLElement, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLElement, HTMLElement>) =>
      measureMessageElement(runtime, element, entry, instance),
    onChange: () => {
      runtime.onVirtualizerChange?.();
    },
  };
}

function updateMessageVirtualizerOptions(runtime: MessageVirtualizerRuntime): void {
  runtime.virtualizer.setOptions(messageVirtualizerOptions(runtime));
  configureMessageVirtualizerSizeAdjustment(runtime);
}

function configureMessageVirtualizerSizeAdjustment(runtime: MessageVirtualizerRuntime): void {
  // TanStack Virtual exposes this as an instance field rather than a normal option in v3.17.
  runtime.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    shouldAdjustMessageScrollPositionOnItemSizeChange(runtime, item, delta, instance);
}

function scrollMessageVirtualizerBy(runtime: MessageVirtualizerRuntime, delta: number): void {
  runtime.followEndIntent = false;
  cancelSettledMessageVirtualizerScrollToEnd(runtime);
  runtime.bottomReconcileCommitGeneration = null;
  runtime.virtualizer.scrollBy(delta);
}

function hasMessageVirtualizerFollowEndIntent(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.followEndIntent;
}

function requestMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime): void {
  runtime.followEndIntent = true;
  runtime.virtualizer.getTotalSize();
  runtime.virtualizer.scrollToEnd();
  reconcileMessageVirtualizerDomEnd(runtime);
  scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime);
  scheduleSettledMessageVirtualizerScrollToEnd(runtime);
}

function scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime: MessageVirtualizerRuntime): void {
  runtime.bottomReconcileCommitGeneration = runtime.commitGeneration + 1;
}

function scheduleSettledMessageVirtualizerScrollToEnd(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) return;
  // scrollToEnd can be clamped before the virtualizer height reaches the DOM; keep a bounded post-render settle.
  runtime.settleScrollToEndAttemptsRemaining = MESSAGE_SCROLL_TO_END_SETTLE_ATTEMPTS;
  if (runtime.settleScrollToEndFrame !== null) return;
  scheduleSettledMessageVirtualizerScrollToEndFrame(runtime, container, 2);
}

function scheduleSettledMessageVirtualizerScrollToEndFrame(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  delayFrames: number,
): void {
  runtime.settleScrollToEndFrame = container.win.requestAnimationFrame(() => {
    runtime.settleScrollToEndFrame = null;
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
  const container = runtime.container;
  if (container && runtime.settleScrollToEndFrame !== null) {
    container.win.cancelAnimationFrame(runtime.settleScrollToEndFrame);
  }
  runtime.settleScrollToEndFrame = null;
  runtime.settleScrollToEndAttemptsRemaining = 0;
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
  if (entry && hasMessageVirtualizerFollowEndIntent(runtime)) scheduleMessageVirtualizerBottomReconcileAfterCommit(runtime);
  return size;
}

function shouldAdjustMessageScrollPositionOnItemSizeChange(
  runtime: MessageVirtualizerRuntime,
  item: VirtualItem,
  _delta: number,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): boolean {
  if (!hasMessageVirtualizerFollowEndIntent(runtime)) return false;
  if (runtime.container && !isMessageVirtualizerObservedAtEnd(runtime, runtime.container)) return false;
  return item.start < (instance.scrollOffset ?? 0) && instance.scrollDirection !== "backward";
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
  container.addEventListener("wheel", markUserScrollIntent, { passive: true });
  container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
  container.addEventListener("pointerdown", markUserScrollIntent);
  container.addEventListener("mousedown", markUserScrollIntent);
  container.addEventListener("keydown", markKeyboardScrollIntent);
  return () => {
    container.removeEventListener("wheel", markUserScrollIntent);
    container.removeEventListener("touchstart", markUserScrollIntent);
    container.removeEventListener("pointerdown", markUserScrollIntent);
    container.removeEventListener("mousedown", markUserScrollIntent);
    container.removeEventListener("keydown", markKeyboardScrollIntent);
  };
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
