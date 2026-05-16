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

export const MESSAGE_BOTTOM_THRESHOLD = 80;
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
  const key = anchor.getAttribute(MESSAGE_BLOCK_KEY_ATTRIBUTE);
  if (!key) return null;

  return {
    key,
    offset: anchor.offsetTop - viewportTop,
    fallbackTop: viewportTop,
  };
}

export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | null): void {
  if (!anchor) return;

  const escapedKey = anchor.key.replace(/["\\]/g, "\\$&");
  const element = container.querySelector<HTMLElement>(`:scope > [${MESSAGE_BLOCK_KEY_ATTRIBUTE}="${escapedKey}"]`);
  if (element) {
    container.scrollTop = element.offsetTop - anchor.offset;
    return;
  }

  container.scrollTop = Math.min(anchor.fallbackTop, Math.max(0, container.scrollHeight - container.clientHeight));
}
