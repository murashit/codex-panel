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

type MessageVirtualizerReadingAnchorState = { kind: "inactive" } | { kind: "active"; anchor: MessageVirtualizerReadingAnchor | null };

type MessageVirtualizerUserScrollState = "idle" | "pending" | "active";

interface MessageVirtualizerScrollPolicyReconcileRequest {
  // Follow-end needs a bounded settle when the browser clamps before DOM height catches up.
  requireFollowEndSettleFrame: boolean;
  scheduleFollowEndSettle: boolean;
  // Reading-anchor restores can overshoot when measured content shrinks near the end.
  clampReadingAnchorToEnd: boolean;
}

const MESSAGE_BOTTOM_THRESHOLD = 4;
const MESSAGE_BLOCK_ESTIMATE_SIZE = 96;
const MESSAGE_FOLLOW_END_SETTLE_ATTEMPTS = 4;
export interface MessageStreamVirtualizerView {
  getTotalSize(): number;
  getVirtualItems(): VirtualItem[];
  measureElement(element: HTMLElement | null, options?: MessageStreamVirtualizerMeasureOptions): void;
}

export interface MessageStreamVirtualizerMeasureOptions {
  clampReadingAnchorToEnd?: boolean;
}

interface MessageVirtualizerRuntime {
  container: HTMLElement | null;
  virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  cleanupVirtualizer: (() => void) | null;
  blocks: readonly MessageStreamBlock[];
  pendingScrollPolicyReconcile: MessageVirtualizerScrollPolicyReconcileRequest | null;
  onVirtualizerChange: (() => void) | null;
  followingEnd: boolean;
  readingAnchor: MessageVirtualizerReadingAnchorState;
  viewportMeasurementsInvalid: boolean;
  viewportRestoreFrame: number | null;
  virtualizerChangeFrame: number | null;
  followEndSettleFrame: number | null;
  followEndSettleAttemptsRemaining: number;
  userScroll: MessageVirtualizerUserScrollState;
}

type MessageVirtualizerFrameKey = "viewportRestoreFrame" | "virtualizerChangeFrame" | "followEndSettleFrame";

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
    reconcileMessageVirtualizerScrollPolicyAfterCommit(runtime);
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
      measureElement(element, options) {
        measureMessageVirtualizerElement(runtime, element, options);
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
    pendingScrollPolicyReconcile: null,
    onVirtualizerChange: null,
    followingEnd: false,
    readingAnchor: { kind: "inactive" },
    viewportMeasurementsInvalid: false,
    viewportRestoreFrame: null,
    virtualizerChangeFrame: null,
    followEndSettleFrame: null,
    followEndSettleAttemptsRemaining: 0,
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
    appendingBlocks && (isMessageVirtualizerFollowingEnd(runtime) || isMessageVirtualizerObservedAtEnd(runtime, container));
  runtime.blocks = blocks;
  if (blocks.length > 0 && shouldFollowAppend) setMessageVirtualizerFollowEnd(runtime);
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  requestMessageVirtualizerScrollPolicyReconcile(runtime);
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

function getMessageVirtualizerTotalSize(runtime: MessageVirtualizerRuntime): number {
  const totalSize = getRenderedMessageVirtualizerTotalSize(runtime, runtime.virtualizer.getTotalSize());
  const container = runtime.container;
  if (!container || !isMessageVirtualizerReadingAnchorActive(runtime)) return totalSize;
  if (isScrollOffsetAtEnd(container.scrollTop, container.clientHeight, totalSize, MESSAGE_BOTTOM_THRESHOLD)) return totalSize;
  return Math.max(totalSize, container.scrollTop + container.clientHeight + MESSAGE_BOTTOM_THRESHOLD + 1);
}

function getMessageVirtualizerItems(runtime: MessageVirtualizerRuntime): VirtualItem[] {
  return runtime.virtualizer.getVirtualItems();
}

function getRenderedMessageVirtualizerTotalSize(runtime: MessageVirtualizerRuntime, totalSize: number): number {
  const container = runtime.container;
  if (!container || runtime.blocks.length === 0) return totalSize;
  const elementsByKey = new Map<string, HTMLElement>();
  for (const element of renderedMessageBlockElements(container)) {
    const key = element.dataset["codexPanelBlockKey"];
    if (key !== undefined) elementsByKey.set(key, element);
  }
  if (elementsByKey.size < runtime.blocks.length) return totalSize;

  const itemsByKey = new Map<unknown, VirtualItem>();
  for (const item of runtime.virtualizer.getVirtualItems()) itemsByKey.set(item.key, item);

  let renderedEnd = 0;
  for (const block of runtime.blocks) {
    const element = elementsByKey.get(block.key);
    const item = itemsByKey.get(block.key);
    if (!element || !item) return totalSize;
    renderedEnd = Math.max(renderedEnd, item.start + element.offsetHeight);
  }
  return Math.min(totalSize, renderedEnd + messageBlockPadding(container));
}

function measureMessageVirtualizerElement(
  runtime: MessageVirtualizerRuntime,
  element: HTMLElement | null,
  options: MessageStreamVirtualizerMeasureOptions = {},
): void {
  prepareMessageVirtualizerScrollPolicyForMeasurement(runtime);
  runtime.virtualizer.measureElement(element);
  if (element) {
    requestMessageVirtualizerScrollPolicyReconcile(runtime, {
      clampReadingAnchorToEnd: options.clampReadingAnchorToEnd === true && isMessageVirtualizerReadingAnchorActive(runtime),
      notify: true,
      requireFollowEndSettleFrame: true,
    });
  }
}

function prepareMessageVirtualizerScrollPolicyForMeasurement(runtime: MessageVirtualizerRuntime): void {
  const wasFollowingEnd = isMessageVirtualizerFollowingEnd(runtime);
  const scrollOffsetMovedAwayFromEnd = syncMessageVirtualizerDomScrollOffset(runtime);
  if (wasFollowingEnd && !scrollOffsetMovedAwayFromEnd) setMessageVirtualizerFollowEnd(runtime);
}

function reconcileMessageVirtualizerScrollPolicyAfterCommit(runtime: MessageVirtualizerRuntime): void {
  const request = runtime.pendingScrollPolicyReconcile;
  if (!request) return;
  runtime.pendingScrollPolicyReconcile = null;
  reconcileMessageVirtualizerScrollPolicy(runtime, request);
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

function syncMessageVirtualizerDomScrollOffset(runtime: MessageVirtualizerRuntime): boolean {
  const container = runtime.container;
  if (!container) return false;
  // Ignore stale programmatic scroll events while follow-end settle is still authoritative.
  if (isMessageVirtualizerFollowingEnd(runtime) && hasPendingMessageVirtualizerFollowEndSettle(runtime)) return false;
  const offset = container.scrollTop;
  const previousOffset = runtime.virtualizer.scrollOffset;
  const offsetChanged = previousOffset !== null && offset !== previousOffset;
  if (previousOffset !== null && offset !== previousOffset) {
    runtime.virtualizer.scrollDirection = offset < previousOffset ? "backward" : "forward";
  }
  runtime.virtualizer.scrollOffset = offset;
  const scrollOffsetMovedAwayFromEnd = didMessageVirtualizerDomOffsetMoveAwayFromEnd(runtime, container, offsetChanged);
  if (scrollOffsetMovedAwayFromEnd) {
    setMessageVirtualizerReadingAnchor(runtime, runtime.readingAnchor.kind === "active" ? runtime.readingAnchor.anchor : null);
  }
  return scrollOffsetMovedAwayFromEnd;
}

function isMessageVirtualizerObservedAtEnd(runtime: MessageVirtualizerRuntime, container = runtime.container): boolean {
  if (!container) return false;
  return isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD);
}

function didMessageVirtualizerDomOffsetMoveAwayFromEnd(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  offsetChanged: boolean,
): boolean {
  return offsetChanged && !isMessageVirtualizerObservedAtEnd(runtime, container);
}

function hasPendingMessageVirtualizerFollowEndSettle(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.followEndSettleFrame !== null;
}

function setMessageVirtualizerFollowEnd(runtime: MessageVirtualizerRuntime): void {
  runtime.followingEnd = true;
  resetMessageVirtualizerReadingAnchor(runtime);
  updateMessageVirtualizerOptions(runtime);
}

function clearMessageVirtualizerFollowEnd(runtime: MessageVirtualizerRuntime): void {
  runtime.followingEnd = false;
}

function setMessageVirtualizerReadingAnchor(runtime: MessageVirtualizerRuntime, anchor: MessageVirtualizerReadingAnchor | null): void {
  runtime.readingAnchor = { kind: "active", anchor };
}

function resetMessageVirtualizerReadingAnchor(runtime: MessageVirtualizerRuntime): void {
  runtime.readingAnchor = { kind: "inactive" };
}

function resetMessageVirtualizerScrollPolicy(runtime: MessageVirtualizerRuntime): void {
  runtime.followingEnd = false;
  resetMessageVirtualizerReadingAnchor(runtime);
  updateMessageVirtualizerOptions(runtime);
}

function cancelPendingMessageVirtualizerScrollPolicyReconcile(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFollowEndSettle(runtime);
  runtime.pendingScrollPolicyReconcile = null;
}

function setMessageVirtualizerChangeHandler(runtime: MessageVirtualizerRuntime, callback: (() => void) | null): void {
  runtime.onVirtualizerChange = callback;
}

function pinMessageVirtualizerToBottom(runtime: MessageVirtualizerRuntime, container = runtime.container): void {
  if (!container) return;
  attachMessageVirtualizer(runtime, container);
  updateMessageVirtualizerOptions(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  requestMessageVirtualizerFollowEnd(runtime, { notify: true });
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
  if (isMessageVirtualizerFollowingEnd(runtime)) {
    requestMessageVirtualizerFollowEnd(runtime, {
      ...(options.notify === undefined ? {} : { notify: options.notify }),
      requireFollowEndSettleFrame: true,
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
    requestMessageVirtualizerFollowEnd(runtime, { notify: true });
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
  cancelPendingMessageVirtualizerScrollPolicyReconcile(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  runtime.pendingScrollPolicyReconcile = null;
  runtime.onVirtualizerChange = null;
  resetMessageVirtualizerScrollPolicy(runtime);
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
  cancelPendingMessageVirtualizerScrollPolicyReconcile(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = null;
  runtime.blocks = [];
  resetMessageVirtualizerScrollPolicy(runtime);
  runtime.viewportMeasurementsInvalid = false;
  runtime.userScroll = "idle";
  runtime.pendingScrollPolicyReconcile = null;
}

function resetMessageVirtualizer(runtime: MessageVirtualizerRuntime, container: HTMLElement): void {
  cancelViewportRestoreMessageVirtualizerReset(runtime);
  cancelDeferredMessageVirtualizerChange(runtime);
  cancelMessageVirtualizerFollowEndSettle(runtime);
  runtime.cleanupVirtualizer?.();
  runtime.cleanupVirtualizer = null;
  runtime.container = container;
  resetMessageVirtualizerScrollPolicy(runtime);
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
    anchorTo: "end",
    followOnAppend: "auto",
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
    setMessageVirtualizerFollowEnd(runtime);
    return;
  }
  if (!userIntendedScroll) return;
  clearMessageVirtualizerFollowEnd(runtime);
  setMessageVirtualizerReadingAnchor(runtime, captureMessageVirtualizerReadingAnchorValue(runtime));
  cancelPendingMessageVirtualizerScrollPolicyReconcile(runtime);
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
  runtime.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => item.end <= (instance.scrollOffset ?? 0);
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
  syncMessageVirtualizerDomScrollOffset(runtime);
  const initialOffset = container.scrollTop;
  runtime.virtualizer.scrollBy(delta);
  syncMessageVirtualizerDomScrollOffset(runtime);
  const reachedEnd = delta > 0 && isMessageVirtualizerObservedAtEnd(runtime, container);
  if (Math.abs(container.scrollTop - initialOffset) <= 1) {
    if (reachedEnd) setMessageVirtualizerFollowEnd(runtime);
    return;
  }

  clearMessageVirtualizerFollowEnd(runtime);
  cancelPendingMessageVirtualizerScrollPolicyReconcile(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  notifyMessageVirtualizerChange(runtime);
  if (reachedEnd) {
    setMessageVirtualizerFollowEnd(runtime);
  } else {
    setMessageVirtualizerReadingAnchor(runtime, captureMessageVirtualizerReadingAnchorValue(runtime));
  }
}

function isMessageVirtualizerFollowingEnd(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.followingEnd;
}

function isMessageVirtualizerReadingAnchorActive(runtime: MessageVirtualizerRuntime): boolean {
  return runtime.readingAnchor.kind === "active";
}

function requestMessageVirtualizerFollowEnd(
  runtime: MessageVirtualizerRuntime,
  options: { notify?: boolean; requireFollowEndSettleFrame?: boolean } = {},
): void {
  setMessageVirtualizerFollowEnd(runtime);
  requestMessageVirtualizerScrollPolicyReconcile(runtime, options);
}

function requestMessageVirtualizerScrollPolicyReconcile(
  runtime: MessageVirtualizerRuntime,
  options: {
    notify?: boolean;
    requireFollowEndSettleFrame?: boolean;
    scheduleFollowEndSettle?: boolean;
    clampReadingAnchorToEnd?: boolean;
  } = {},
): void {
  runtime.pendingScrollPolicyReconcile = mergeMessageVirtualizerScrollPolicyReconcileRequest(runtime.pendingScrollPolicyReconcile, options);
  if (options.notify) notifyMessageVirtualizerChange(runtime);
}

function mergeMessageVirtualizerScrollPolicyReconcileRequest(
  current: MessageVirtualizerScrollPolicyReconcileRequest | null,
  options: { requireFollowEndSettleFrame?: boolean; scheduleFollowEndSettle?: boolean; clampReadingAnchorToEnd?: boolean },
): MessageVirtualizerScrollPolicyReconcileRequest {
  return {
    requireFollowEndSettleFrame: current?.requireFollowEndSettleFrame === true || options.requireFollowEndSettleFrame === true,
    scheduleFollowEndSettle: (current?.scheduleFollowEndSettle ?? true) && options.scheduleFollowEndSettle !== false,
    clampReadingAnchorToEnd: current?.clampReadingAnchorToEnd === true || options.clampReadingAnchorToEnd === true,
  };
}

function reconcileMessageVirtualizerScrollPolicy(
  runtime: MessageVirtualizerRuntime,
  request: MessageVirtualizerScrollPolicyReconcileRequest,
): void {
  if (!runtime.container) return;
  if (runtime.followingEnd) {
    reconcileMessageVirtualizerFollowEnd(runtime, request);
    return;
  }
  if (isMessageVirtualizerReadingAnchorActive(runtime)) {
    reconcileMessageVirtualizerReadingAnchor(runtime, { clampToEnd: request.clampReadingAnchorToEnd });
  }
}

function reconcileMessageVirtualizerFollowEnd(
  runtime: MessageVirtualizerRuntime,
  options: { requireFollowEndSettleFrame?: boolean; scheduleFollowEndSettle?: boolean } = {},
): void {
  runtime.virtualizer.getTotalSize();
  runtime.virtualizer.scrollToEnd();
  reconcileMessageVirtualizerDomEnd(runtime);
  if (options.scheduleFollowEndSettle !== false) {
    scheduleMessageVirtualizerFollowEndSettle(
      runtime,
      options.requireFollowEndSettleFrame === undefined ? {} : { requireFollowEndSettleFrame: options.requireFollowEndSettleFrame },
    );
  }
}

function scheduleMessageVirtualizerFollowEndSettle(
  runtime: MessageVirtualizerRuntime,
  options: { requireFollowEndSettleFrame?: boolean } = {},
): void {
  const container = runtime.container;
  if (!container) return;
  if (options.requireFollowEndSettleFrame !== true && !shouldMessageVirtualizerSettleFollowEnd(runtime, container)) {
    cancelMessageVirtualizerFollowEndSettle(runtime);
    return;
  }
  // scrollToEnd can be clamped before the virtualizer height reaches the DOM; keep a bounded post-render settle.
  runtime.followEndSettleAttemptsRemaining = MESSAGE_FOLLOW_END_SETTLE_ATTEMPTS;
  if (runtime.followEndSettleFrame !== null) return;
  scheduleMessageVirtualizerFollowEndSettleFrame(runtime, container, 2);
}

function shouldMessageVirtualizerSettleFollowEnd(runtime: MessageVirtualizerRuntime, container: HTMLElement): boolean {
  if (!isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD)) return true;
  // Hidden/resumed panes can start with rendered blocks but no scroll range yet; give the DOM a few frames to expose it.
  return runtime.blocks.length > 0 && container.scrollHeight <= container.clientHeight;
}

function scheduleMessageVirtualizerFollowEndSettleFrame(
  runtime: MessageVirtualizerRuntime,
  container: HTMLElement,
  delayFrames: number,
): void {
  scheduleMessageVirtualizerFrame(runtime, "followEndSettleFrame", container, () => {
    if (runtime.container !== container) {
      runtime.followEndSettleAttemptsRemaining = 0;
      return;
    }
    if (delayFrames > 1) {
      scheduleMessageVirtualizerFollowEndSettleFrame(runtime, container, delayFrames - 1);
      return;
    }
    if (!isMessageVirtualizerFollowingEnd(runtime)) {
      runtime.followEndSettleAttemptsRemaining = 0;
      return;
    }
    runtime.followEndSettleAttemptsRemaining = Math.max(0, runtime.followEndSettleAttemptsRemaining - 1);
    requestMessageVirtualizerScrollPolicyReconcile(runtime, { notify: true, scheduleFollowEndSettle: false });
    if (
      runtime.followEndSettleAttemptsRemaining > 0 &&
      !isElementAtEnd(container, runtime.virtualizer.getTotalSize(), MESSAGE_BOTTOM_THRESHOLD)
    ) {
      scheduleMessageVirtualizerFollowEndSettleFrame(runtime, container, 1);
    }
  });
}

function reconcileMessageVirtualizerDomEnd(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container) return;
  const domEnd = Math.max(0, container.scrollHeight - container.clientHeight);
  if (domEnd > container.scrollTop) container.scrollTop = domEnd;
}

function cancelMessageVirtualizerFollowEndSettle(runtime: MessageVirtualizerRuntime): void {
  cancelMessageVirtualizerFrame(runtime, "followEndSettleFrame");
  runtime.followEndSettleAttemptsRemaining = 0;
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
    requestMessageVirtualizerScrollPolicyReconcile(runtime, {
      clampReadingAnchorToEnd: isMessageVirtualizerReadingAnchorActive(runtime),
      notify: true,
      requireFollowEndSettleFrame: isMessageVirtualizerFollowingEnd(runtime),
    });
  }
  return size;
}

function captureMessageVirtualizerReadingAnchorValue(runtime: MessageVirtualizerRuntime): MessageVirtualizerReadingAnchor | null {
  const container = runtime.container;
  if (!container) return null;
  const scrollOffset = container.scrollTop;
  const anchor = runtime.virtualizer.getVirtualItemForOffset(scrollOffset);
  return anchor ? { key: anchor.key, top: anchor.start - scrollOffset } : null;
}

function reconcileMessageVirtualizerReadingAnchor(runtime: MessageVirtualizerRuntime, options: { clampToEnd?: boolean } = {}): void {
  const container = runtime.container;
  const state = runtime.readingAnchor;
  const anchor = state.kind === "active" ? state.anchor : null;
  if (!container || state.kind !== "active") return;

  const item = anchor ? runtime.virtualizer.getVirtualItems().find((candidate) => Object.is(candidate.key, anchor.key)) : null;

  if (anchor && item) {
    const targetOffset = item.start - anchor.top;
    if (Math.abs(container.scrollTop - targetOffset) > 1) {
      runtime.virtualizer.scrollToOffset(targetOffset);
      syncMessageVirtualizerDomScrollOffset(runtime);
      updateMessageVirtualizer(runtime.virtualizer);
      notifyMessageVirtualizerChange(runtime);
    }
  }
  if (options.clampToEnd) clampMessageVirtualizerReadingAnchorOffsetToEnd(runtime);
}

function clampMessageVirtualizerReadingAnchorOffsetToEnd(runtime: MessageVirtualizerRuntime): void {
  const container = runtime.container;
  if (!container || !isMessageVirtualizerReadingAnchorActive(runtime)) return;
  const rawTotalSize = runtime.virtualizer.getTotalSize();
  if (container.scrollHeight <= getMessageVirtualizerTotalSize(runtime) + MESSAGE_BOTTOM_THRESHOLD) return;
  const rawScrollEnd = Math.max(0, rawTotalSize - container.clientHeight);
  if (!isScrollOffsetAtEnd(container.scrollTop, container.clientHeight, rawTotalSize, MESSAGE_BOTTOM_THRESHOLD)) return;
  runtime.virtualizer.scrollToOffset(rawScrollEnd);
  syncMessageVirtualizerDomScrollOffset(runtime);
  updateMessageVirtualizer(runtime.virtualizer);
  setMessageVirtualizerFollowEnd(runtime);
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
