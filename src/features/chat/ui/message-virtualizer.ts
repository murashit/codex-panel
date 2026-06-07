import { observeElementOffset, Virtualizer, type Rect, type VirtualItem } from "@tanstack/virtual-core";

import type { MessageStreamBlock } from "./message-stream/context";

export type MessageStreamScrollIntent = "auto" | "force-bottom" | "preserve";
type MessageScrollDirection = -1 | 1;

interface MessageVirtualizerRenderPlan {
  generation: number;
  shouldScrollToBottom: boolean;
}

interface MessageStreamVirtualizerOptions {
  messagesPinnedToBottom: () => boolean;
  setMessagesPinnedToBottom: (pinned: boolean) => void;
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

  constructor(private readonly options: MessageStreamVirtualizerOptions) {}

  prepareRender(
    container: HTMLElement,
    intent: MessageStreamScrollIntent,
    blocks: readonly MessageStreamBlock[],
  ): MessageVirtualizerRenderPlan {
    this.attach(container);
    this.blocks = blocks;

    const virtualizer = this.requireVirtualizer();
    virtualizer.setOptions(this.virtualizerOptions());
    virtualizer._willUpdate();

    const shouldScrollToBottom =
      intent === "force-bottom" ||
      (intent !== "preserve" && (this.options.messagesPinnedToBottom() || virtualizer.isAtEnd(MESSAGE_BOTTOM_THRESHOLD)));
    this.options.setMessagesPinnedToBottom(shouldScrollToBottom);

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
    }
    this.updatePinnedState();
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
    this.updatePinnedState();
  }

  correctAfterLayoutChange(): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;

    virtualizer.measure();
    virtualizer._willUpdate();
    if (this.options.messagesPinnedToBottom() || virtualizer.isAtEnd(MESSAGE_BOTTOM_THRESHOLD)) {
      virtualizer.scrollToEnd();
    }
    this.updatePinnedState();
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
  }

  private attach(container: HTMLElement): void {
    if (this.container === container && this.virtualizer) return;

    this.dispose();
    this.container = container;
    this.virtualizer = new Virtualizer(this.virtualizerOptions());
    this.cleanupVirtualizer = this.virtualizer._didMount();
    this.virtualizer._willUpdate();
  }

  private requireVirtualizer(): Virtualizer<HTMLElement, HTMLElement> {
    if (!this.virtualizer) throw new Error("Expected message virtualizer to be attached.");
    return this.virtualizer;
  }

  private virtualizerOptions() {
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
      overscan: 8,
      observeElementRect: observeMessageElementRect,
      observeElementOffset: (instance: Virtualizer<HTMLElement, HTMLElement>, callback: (offset: number, isScrolling: boolean) => void) =>
        observeElementOffset(instance, (offset, isScrolling) => {
          callback(offset, isScrolling);
          this.updatePinnedState();
        }),
      scrollToFn: scrollMessageElement,
      measureElement: measureMessageElement,
      onChange: (instance: Virtualizer<HTMLElement, HTMLElement>) => {
        this.options.setMessagesPinnedToBottom(instance.isAtEnd(MESSAGE_BOTTOM_THRESHOLD));
        this.onVirtualizerChange?.();
      },
    };
  }

  private scrollBy(delta: number): void {
    const virtualizer = this.virtualizer;
    const container = this.container;
    if (!virtualizer || !container) return;
    virtualizer.scrollToOffset(container.scrollTop + delta);
    this.updatePinnedState();
  }

  private updatePinnedState(): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    this.options.setMessagesPinnedToBottom(virtualizer.isAtEnd(MESSAGE_BOTTOM_THRESHOLD));
  }
}

function observeMessageElementRect(instance: Virtualizer<HTMLElement, HTMLElement>, cb: (rect: Rect) => void): undefined | (() => void) {
  const element = instance.scrollElement;
  if (!element) return;

  const targetWindow = instance.targetWindow;
  const readRect = () => {
    cb({ width: element.clientWidth || element.offsetWidth, height: element.clientHeight || element.offsetHeight || 1 });
  };
  readRect();

  if (!targetWindow?.ResizeObserver) return;

  const observer = new targetWindow.ResizeObserver(readRect);
  observer.observe(element, { box: "border-box" });
  return () => {
    observer.disconnect();
  };
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
  const scrollSize = element.scrollHeight || instance.getTotalSize();
  const top = scrollSize > 0 ? Math.min(Math.max(0, scrollSize - element.clientHeight), unclampedTop) : unclampedTop;
  const previousTop = element.scrollTop;
  const behavior = options.behavior === "instant" ? "auto" : options.behavior;
  if (typeof element.scrollTo === "function") {
    if (behavior) {
      element.scrollTo({ top, behavior });
    } else {
      element.scrollTo({ top });
    }
  } else {
    element.scrollTop = top;
  }
  if (element.scrollTop !== previousTop) {
    element.dispatchEvent(new Event("scroll"));
  }
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
