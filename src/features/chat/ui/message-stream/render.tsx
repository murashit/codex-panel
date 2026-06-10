import type { ComponentChild as UiNode } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import { type MessageStreamScrollIntent, type MessageStreamVirtualizerHandle, useMessageStreamVirtualizer } from "../message-virtualizer";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../message-content-events";
import type { MessageStreamBlock } from "./context";

const MESSAGE_BLOCK_ESTIMATE_SIZE = 96;
const MESSAGE_STREAM_INITIAL_RENDER_LIMIT = 32;

export interface MessageStreamRenderState {
  blocks: MessageStreamBlock[];
  consumeScrollIntent: () => MessageStreamScrollIntent;
  registerVirtualizer?: (virtualizer: MessageStreamVirtualizerHandle) => () => void;
}

export function messageStreamBlocksNode(state: MessageStreamRenderState): UiNode {
  return <MessageStreamBlocks state={state} />;
}

function MessageStreamBlocks({ state }: { state: MessageStreamRenderState }): UiNode {
  const { blocks, consumeScrollIntent, registerVirtualizer } = state;
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useMessageStreamVirtualizer({ blocks, consumeScrollIntent, registerVirtualizer, scrollElementRef });
  const virtualItems = messageStreamVirtualItems(virtualizer.getVirtualItems(), blocks, scrollElementRef.current?.scrollTop ?? 0);
  const measureBlock = useCallback(
    (element: HTMLElement | null) => {
      virtualizer.measureElement(element);
    },
    [virtualizer],
  );

  return (
    <div ref={scrollElementRef} className="codex-panel__region codex-panel__region--messages codex-panel__messages">
      <div className="codex-panel__message-virtualizer" style={{ height: `${String(virtualizer.getTotalSize())}px` }}>
        {virtualItems.map((virtualItem) => (
          <MessageStreamBlockHost
            key={String(virtualItem.key)}
            block={blocks[virtualItem.index]}
            measureBlock={measureBlock}
            virtualItem={virtualItem}
          />
        ))}
      </div>
    </div>
  );
}

export function messageStreamVirtualItems(
  virtualItems: { index: number; key: unknown; start: number }[],
  blocks: readonly MessageStreamBlock[],
  scrollOffset = 0,
) {
  if (virtualItems.length > 0 || blocks.length === 0) return virtualItems;
  const startIndex = messageStreamFallbackStartIndex(blocks.length, scrollOffset);
  return blocks.slice(startIndex, startIndex + MESSAGE_STREAM_INITIAL_RENDER_LIMIT).map((block, offset) => {
    const index = startIndex + offset;
    return {
      index,
      key: block.key,
      start: index * MESSAGE_BLOCK_ESTIMATE_SIZE,
    };
  });
}

function messageStreamFallbackStartIndex(blockCount: number, scrollOffset: number): number {
  const maxStartIndex = Math.max(0, blockCount - MESSAGE_STREAM_INITIAL_RENDER_LIMIT);
  const estimatedFirstVisibleIndex = Math.max(0, Math.floor(scrollOffset / MESSAGE_BLOCK_ESTIMATE_SIZE));
  const centeredStartIndex = Math.max(0, estimatedFirstVisibleIndex - Math.floor(MESSAGE_STREAM_INITIAL_RENDER_LIMIT / 2));
  return Math.min(centeredStartIndex, maxStartIndex);
}

function MessageStreamBlockHost({
  block,
  measureBlock,
  virtualItem,
}: {
  block: MessageStreamBlock | undefined;
  measureBlock: (element: HTMLElement | null) => void;
  virtualItem: { index: number; start: number };
}): UiNode {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const cleanupContentRenderedListener = useRef<(() => void) | null>(null);
  const setBlock = useCallback(
    (element: HTMLDivElement | null) => {
      cleanupContentRenderedListener.current?.();
      cleanupContentRenderedListener.current = null;
      blockRef.current = element;
      measureBlock(element);
      if (!element) return;
      const remeasure = () => {
        if (blockRef.current === element && element.isConnected) measureBlock(element);
        element.win.requestAnimationFrame(() => {
          if (blockRef.current === element && element.isConnected) measureBlock(element);
        });
      };
      element.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, remeasure);
      cleanupContentRenderedListener.current = () => {
        element.removeEventListener(MESSAGE_CONTENT_RENDERED_EVENT, remeasure);
      };
    },
    [measureBlock],
  );

  useLayoutEffect(() => {
    return () => {
      cleanupContentRenderedListener.current?.();
      cleanupContentRenderedListener.current = null;
    };
  }, []);

  if (!block) return null;

  return (
    <div
      ref={setBlock}
      className="codex-panel__message-block"
      data-codex-panel-block-key={block.key}
      data-index={String(virtualItem.index)}
      style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
    >
      {block.node}
    </div>
  );
}
