import { observeElementOffset, observeElementRect, Virtualizer, type VirtualItem } from "@tanstack/virtual-core";

import type { MessageStreamBlock } from "./message-stream/context";

export type MessageStreamScrollIntent = "auto" | "force-bottom" | "preserve";
type MessageScrollDirection = -1 | 1;

interface MessageVirtualizerRenderPlan {
  generation: number;
  shouldScrollToBottom: boolean;
}

const MESSAGE_BOTTOM_THRESHOLD = 4;
const MESSAGE_BLOCK_ESTIMATE_SIZE = 96;
export const MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE = "data-codex-panel-virtual-index";

export class MessageStreamVirtualizer {
  private container: HTMLElement | null = null;
  private virtualizer: Virtualizer<HTMLElement, HTMLElement> | null = null;
  private cleanupVirtualizer: (() => void) | null = null;
  private blocks: readonly MessageStreamBlock[] = [];
  private renderGeneration = 0;
  private onVirtualizerChange: (() => void) | null = null;
  private lastObservedViewportHeight: number | null = null;
  private bottomPinnedBeforeViewportResize = true;

  prepareRender(
    container: HTMLElement,
    intent: MessageStreamScrollIntent,
    blocks: readonly MessageStreamBlock[],
  ): MessageVirtualizerRenderPlan {
    this.attach(container);
    const virtualizer = this.requireVirtualizer();
    const pinnedBeforeRender = isElementPinnedAtBottom(container, virtualizer.getTotalSize());

    this.blocks = blocks;
    virtualizer.setOptions(this.virtualizerOptions());
    virtualizer._willUpdate();

    const shouldScrollToBottom = intent === "force-bottom" || (intent !== "preserve" && pinnedBeforeRender);

    return {
      generation: ++this.renderGeneration,
      shouldScrollToBottom,
    };
  }

  completeRender(plan: MessageVirtualizerRenderPlan): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer || plan.generation !== this.renderGeneration) return;

    virtualizer._willUpdate();
    if (plan.shouldScrollToBottom) {
      virtualizer.scrollToEnd();
      this.rememberScrollMetrics(undefined, { forcePinned: true });
      return;
    }
    this.rememberScrollMetrics(undefined, { scrollSize: virtualizer.getTotalSize() });
  }

  getTotalSize(): number {
    return this.virtualizer?.getTotalSize() ?? 0;
  }

  getVirtualItems(): VirtualItem[] {
    return this.virtualizer?.getVirtualItems() ?? [];
  }

  measureElement(element: HTMLElement | null): void {
    this.virtualizer?.measureElement(element);
  }

  onChange(callback: (() => void) | null): void {
    this.onVirtualizerChange = callback;
  }

  pinToBottom(container = this.container): void {
    if (!container) return;
    this.attach(container);
    this.virtualizer?.scrollToEnd();
    this.rememberScrollMetrics(undefined, { forcePinned: true });
  }

  scrollByTextLines(direction: MessageScrollDirection, container = this.container): void {
    if (!container) return;
    const delta = Math.max(1, Math.round(textLineHeight(container) * 2)) * direction;
    this.scrollBy(delta);
  }

  scrollByPage(direction: MessageScrollDirection, container = this.container): void {
    if (!container) return;
    const delta = Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
    this.scrollBy(delta);
  }

  dispose(): void {
    this.cleanupVirtualizer?.();
    this.cleanupVirtualizer = null;
    this.virtualizer = null;
    this.container = null;
    this.blocks = [];
    this.onVirtualizerChange = null;
    this.lastObservedViewportHeight = null;
    this.bottomPinnedBeforeViewportResize = true;
  }

  private attach(container: HTMLElement): void {
    if (this.container === container && this.virtualizer) return;

    this.dispose();
    this.container = container;
    this.virtualizer = new Virtualizer(this.virtualizerOptions());
    this.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => this.bottomPinnedBeforeViewportResize;
    this.cleanupVirtualizer = this.virtualizer._didMount();
    this.virtualizer._willUpdate();
  }

  private requireVirtualizer(): Virtualizer<HTMLElement, HTMLElement> {
    if (!this.virtualizer) throw new Error("Expected message virtualizer to be attached.");
    return this.virtualizer;
  }

  private virtualizerOptions() {
    const paddingBlock = messageBlockPadding(this.container);
    return {
      count: this.blocks.length,
      getScrollElement: () => this.container,
      estimateSize: () => MESSAGE_BLOCK_ESTIMATE_SIZE,
      initialOffset: () => this.container?.scrollTop ?? 0,
      getItemKey: (index: number) => this.blocks[index]?.key ?? index,
      indexAttribute: MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE,
      anchorTo: "end" as const,
      followOnAppend: true,
      scrollEndThreshold: MESSAGE_BOTTOM_THRESHOLD,
      paddingStart: paddingBlock,
      paddingEnd: paddingBlock,
      useAnimationFrameWithResizeObserver: true,
      overscan: 8,
      observeElementRect: (instance: Virtualizer<HTMLElement, HTMLElement>, cb: (rect: { width: number; height: number }) => void) =>
        observeElementRect(instance, (rect) => {
          const pinnedBeforeResize = this.bottomPinnedBeforeViewportResize;
          const resized = this.lastObservedViewportHeight !== null && rect.height !== this.lastObservedViewportHeight;
          cb(rect);
          this.lastObservedViewportHeight = rect.height;
          if (resized && pinnedBeforeResize) {
            instance.scrollToEnd();
            this.rememberScrollMetrics(instance.scrollElement, { forcePinned: true });
            return;
          }
          this.rememberScrollMetrics(instance.scrollElement, { scrollSize: instance.getTotalSize() });
        }),
      observeElementOffset: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (offset: number, isScrolling: boolean) => void) =>
        observeElementOffset(instance, (offset, isScrolling) => {
          callback(offset, isScrolling);
          const scrollElement = instance.scrollElement;
          if (scrollElement && this.isViewportResizePending(scrollElement) && this.bottomPinnedBeforeViewportResize) {
            instance.scrollToEnd();
            this.rememberScrollMetrics(scrollElement, { forcePinned: true });
            return;
          }
          this.rememberScrollMetrics(scrollElement, { scrollSize: instance.getTotalSize() });
        }),
      scrollToFn: scrollMessageElement,
      measureElement: measureMessageElement,
      onChange: () => {
        this.onVirtualizerChange?.();
      },
    };
  }

  private scrollBy(delta: number): void {
    const container = this.container;
    if (!container) return;
    scrollMessageElementToTop(container, container.scrollTop + delta);
    this.rememberScrollMetrics(container);
  }

  private isViewportResizePending(element: HTMLElement): boolean {
    return this.lastObservedViewportHeight !== null && element.clientHeight !== this.lastObservedViewportHeight;
  }

  private rememberScrollMetrics(
    element = this.container,
    options: {
      forcePinned?: boolean;
      scrollSize?: number;
    } = {},
  ): void {
    if (!element) {
      this.bottomPinnedBeforeViewportResize = true;
      return;
    }
    this.bottomPinnedBeforeViewportResize = options.forcePinned ? true : isElementPinnedAtBottom(element, options.scrollSize);
  }
}

function isElementPinnedAtBottom(element: HTMLElement, fallbackScrollSize = 0): boolean {
  const scrollSize = fallbackScrollSize > 0 ? fallbackScrollSize : element.scrollHeight;
  return scrollSize - element.clientHeight - element.scrollTop <= MESSAGE_BOTTOM_THRESHOLD;
}

function messageBlockPadding(element: HTMLElement | null): number {
  if (!element) return 0;
  const win = element.ownerDocument.defaultView;
  if (!win) return 0;
  const value = Number.parseFloat(win.getComputedStyle(element).paddingLeft);
  return Number.isFinite(value) ? value : 0;
}

function measureMessageElement(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): number {
  const box = entry?.borderBoxSize[0];
  if (box) return Math.round(box.blockSize);
  return element.offsetHeight || instance.options.estimateSize(instance.indexFromElement(element));
}

function scrollMessageElement(
  offset: number,
  options: { adjustments?: number; behavior?: "auto" | "smooth" | "instant" },
  instance: Virtualizer<HTMLElement, HTMLElement>,
): void {
  const element = instance.scrollElement;
  if (!element) return;

  const unclampedTop = Math.max(0, offset + (options.adjustments ?? 0));
  scrollMessageElementToTop(element, unclampedTop, options.behavior, instance.getTotalSize());
}

function scrollMessageElementToTop(
  element: HTMLElement,
  scrollTop: number,
  behavior?: "auto" | "smooth" | "instant",
  fallbackScrollSize = 0,
): void {
  const scrollSize = Math.max(element.scrollHeight, fallbackScrollSize);
  const top = scrollSize > 0 ? Math.min(Math.max(0, scrollSize - element.clientHeight), Math.max(0, scrollTop)) : Math.max(0, scrollTop);
  const scrollBehavior = behavior === "instant" ? "auto" : behavior;
  if (typeof element.scrollTo === "function") {
    if (scrollBehavior) {
      element.scrollTo({ top, behavior: scrollBehavior });
    } else {
      element.scrollTo({ top });
    }
  } else {
    element.scrollTop = top;
  }
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
