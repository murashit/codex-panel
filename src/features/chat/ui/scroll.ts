export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export interface ScrollAnchor {
  key: string;
  offset: number;
  fallbackTop: number;
}

export type MessageScrollIntent = "auto" | "force-bottom" | "preserve";
export type MessageScrollDirection = -1 | 1;

export interface MessageScrollRenderPlan {
  generation: number;
  anchor: ScrollAnchor | null;
  shouldScrollToBottom: boolean;
}

export interface MessageScrollControllerOptions {
  messagesPinnedToBottom: () => boolean;
  setMessagesPinnedToBottom: (pinned: boolean) => void;
}

export const MESSAGE_BOTTOM_THRESHOLD = 4;
export const MESSAGE_BLOCK_KEY_ATTRIBUTE = "data-codex-panel-block-key";

export function isNearScrollBottom(metrics: ScrollMetrics, threshold = MESSAGE_BOTTOM_THRESHOLD): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}

export function bottomScrollTop(metrics: Pick<ScrollMetrics, "scrollHeight">): number {
  return metrics.scrollHeight;
}

export function captureScrollAnchor(container: HTMLElement): ScrollAnchor | null {
  const children = Array.from(container.querySelectorAll<HTMLElement>(`:scope > [${MESSAGE_BLOCK_KEY_ATTRIBUTE}]`));
  if (children.length === 0) return null;

  const viewportTop = container.scrollTop;
  const anchor = children.find((child) => child.offsetTop + child.offsetHeight >= viewportTop) ?? children[0];
  if (!anchor) return null;
  const key = anchor.getAttribute(MESSAGE_BLOCK_KEY_ATTRIBUTE);
  if (!key) return null;

  return {
    key,
    offset: anchor.offsetTop - viewportTop,
    fallbackTop: viewportTop,
  };
}

export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | null): void {
  const scrollTop = restoredAnchorScrollTop(container, anchor);
  if (scrollTop !== null) container.scrollTop = scrollTop;
}

function restoredAnchorScrollTop(container: HTMLElement, anchor: ScrollAnchor | null): number | null {
  if (!anchor) return null;

  const escapedKey = anchor.key.replace(/["\\]/g, "\\$&");
  const element = container.querySelector<HTMLElement>(`:scope > [${MESSAGE_BLOCK_KEY_ATTRIBUTE}="${escapedKey}"]`);
  if (element) {
    return element.offsetTop - anchor.offset;
  }

  return Math.min(anchor.fallbackTop, Math.max(0, container.scrollHeight - container.clientHeight));
}

export class MessageScrollController {
  private container: HTMLElement | null = null;
  private renderGeneration = 0;
  private renderFrame: number | null = null;
  private resizeFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private observedBlocks = new Set<HTMLElement>();
  private currentAnchor: ScrollAnchor | null = null;
  private lastScrollTop: number | null = null;
  private lastScrollHeight: number | null = null;

  constructor(private readonly options: MessageScrollControllerOptions) {}

  prepareRender(container: HTMLElement, intent: MessageScrollIntent): MessageScrollRenderPlan {
    this.attach(container);
    const shouldPreserveScroll = intent === "preserve";
    const wasNearBottom = shouldPreserveScroll ? false : isNearScrollBottom(container);
    const shouldScrollToBottom =
      !shouldPreserveScroll && (intent === "force-bottom" || this.options.messagesPinnedToBottom() || wasNearBottom);
    const anchor = shouldScrollToBottom ? null : captureScrollAnchor(container);
    this.currentAnchor = anchor;
    this.options.setMessagesPinnedToBottom(shouldScrollToBottom);

    return {
      generation: ++this.renderGeneration,
      anchor,
      shouldScrollToBottom,
    };
  }

  completeRender(plan: MessageScrollRenderPlan): void {
    const container = this.container;
    if (!container) return;

    this.observeMessageBlocks(container);
    this.cancelRenderFrame();
    if (plan.shouldScrollToBottom && this.options.messagesPinnedToBottom()) {
      this.pinToBottom(container);
    }
    this.renderFrame = container.win.requestAnimationFrame(() => {
      this.renderFrame = null;
      if (plan.generation !== this.renderGeneration) return;

      if (plan.shouldScrollToBottom) {
        if (!this.options.messagesPinnedToBottom()) return;
        this.pinToBottom(container);
      } else {
        this.restoreAnchor(container, plan.anchor);
        this.updatePinnedState(container);
      }

      this.rememberCurrentAnchor(container);
      this.observeMessageBlocks(container);
    });
  }

  pinToBottom(container = this.container): void {
    if (!container) return;
    this.setScrollTop(container, bottomScrollTop(container));
    this.updatePinnedState(container);
    this.rememberCurrentAnchor(container);
  }

  scrollByTextLines(direction: MessageScrollDirection, container = this.container): void {
    if (!container) return;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const delta = Math.max(1, Math.round(textLineHeight(container) * 2)) * direction;
    this.setScrollTop(container, Math.min(maxScrollTop, Math.max(0, container.scrollTop + delta)));
    this.updatePinnedState(container);
    this.rememberCurrentAnchor(container);
  }

  scrollByPage(direction: MessageScrollDirection, container = this.container): void {
    if (!container) return;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const delta = Math.max(1, Math.floor(container.clientHeight * 0.8)) * direction;
    this.setScrollTop(container, Math.min(maxScrollTop, Math.max(0, container.scrollTop + delta)));
    this.updatePinnedState(container);
    this.rememberCurrentAnchor(container);
  }

  dispose(): void {
    this.cancelRenderFrame();
    this.cancelResizeFrame();
    if (this.container) {
      this.container.onscroll = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedBlocks.clear();
    this.container = null;
    this.currentAnchor = null;
    this.lastScrollTop = null;
    this.lastScrollHeight = null;
  }

  private attach(container: HTMLElement): void {
    if (this.container === container) return;

    this.dispose();
    this.container = container;
    this.lastScrollTop = container.scrollTop;
    this.lastScrollHeight = container.scrollHeight;
    container.onscroll = this.handleScroll;

    const ResizeObserverConstructor = (container.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      this.resizeObserver = new ResizeObserverConstructor(() => {
        this.scheduleSizeChangeCorrection();
      });
    }
  }

  private readonly handleScroll = (): void => {
    const container = this.container;
    if (!container) return;
    const previousScrollTop = this.lastScrollTop ?? container.scrollTop;
    const previousScrollHeight = this.lastScrollHeight ?? container.scrollHeight;
    const wasPinnedBeforeGrowth =
      previousScrollHeight > 0 &&
      isNearScrollBottom({
        scrollHeight: previousScrollHeight,
        scrollTop: previousScrollTop,
        clientHeight: container.clientHeight,
      });
    const grewSinceLastScroll = container.scrollHeight > previousScrollHeight;
    this.lastScrollTop = container.scrollTop;
    this.lastScrollHeight = container.scrollHeight;
    if (container.scrollTop < previousScrollTop) {
      this.options.setMessagesPinnedToBottom(false);
    } else if (
      !this.options.messagesPinnedToBottom() ||
      (container.scrollTop > previousScrollTop && (!grewSinceLastScroll || !wasPinnedBeforeGrowth))
    ) {
      this.updatePinnedState(container);
    }
    this.rememberCurrentAnchor(container);
  };

  private scheduleSizeChangeCorrection(): void {
    const container = this.container;
    if (!container || this.resizeFrame !== null) return;

    this.resizeFrame = container.win.requestAnimationFrame(() => {
      this.resizeFrame = null;
      const activeContainer = this.container;
      if (!activeContainer) return;

      if (this.options.messagesPinnedToBottom()) {
        this.pinToBottom(activeContainer);
      } else {
        this.restoreAnchor(activeContainer, this.currentAnchor);
        this.updatePinnedState(activeContainer);
        this.rememberCurrentAnchor(activeContainer);
      }

      this.observeMessageBlocks(activeContainer);
    });
  }

  private updatePinnedState(container: HTMLElement, threshold = MESSAGE_BOTTOM_THRESHOLD): void {
    this.options.setMessagesPinnedToBottom(isNearScrollBottom(container, threshold));
  }

  private rememberCurrentAnchor(container: HTMLElement): void {
    this.currentAnchor = this.options.messagesPinnedToBottom() ? null : captureScrollAnchor(container);
  }

  private observeMessageBlocks(container: HTMLElement): void {
    const resizeObserver = this.resizeObserver;
    if (!resizeObserver) return;

    const blocks = new Set(Array.from(container.querySelectorAll<HTMLElement>(`:scope > [${MESSAGE_BLOCK_KEY_ATTRIBUTE}]`)));
    for (const block of this.observedBlocks) {
      if (!blocks.has(block)) resizeObserver.unobserve(block);
    }
    for (const block of blocks) {
      if (!this.observedBlocks.has(block)) resizeObserver.observe(block);
    }
    this.observedBlocks = blocks;
  }

  private cancelRenderFrame(): void {
    if (this.renderFrame === null || !this.container) return;
    this.container.win.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
  }

  private cancelResizeFrame(): void {
    if (this.resizeFrame === null || !this.container) return;
    this.container.win.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
  }

  private setScrollTop(container: HTMLElement, scrollTop: number): void {
    if (container.scrollTop === scrollTop) return;
    container.scrollTop = scrollTop;
    this.lastScrollTop = container.scrollTop;
    this.lastScrollHeight = container.scrollHeight;
  }

  private restoreAnchor(container: HTMLElement, anchor: ScrollAnchor | null): void {
    const scrollTop = restoredAnchorScrollTop(container, anchor);
    if (scrollTop !== null) this.setScrollTop(container, scrollTop);
  }
}

function textLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
}
