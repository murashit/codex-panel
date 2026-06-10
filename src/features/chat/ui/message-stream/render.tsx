import type { ComponentChild as UiNode } from "preact";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";

import { renderUiRoot } from "../../../../shared/ui/ui-root";
import { MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE, type MessageStreamVirtualizer } from "../message-virtualizer";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../message-content-events";
import type { MessageStreamBlock } from "./context";

export function renderMessageStreamBlocks(parent: HTMLElement, blocks: MessageStreamBlock[], virtualizer: MessageStreamVirtualizer): void {
  renderUiRoot(parent, <MessageStreamBlocks blocks={blocks} virtualizer={virtualizer} />);
}

function MessageStreamBlocks({ blocks, virtualizer }: { blocks: MessageStreamBlock[]; virtualizer: MessageStreamVirtualizer }): UiNode {
  const [, setVersion] = useState(0);

  useLayoutEffect(() => {
    virtualizer.onChange(() => {
      setVersion((version) => version + 1);
    });
    return () => {
      virtualizer.onChange(null);
    };
  }, [virtualizer]);

  const measureBlock = useCallback(
    (element: HTMLElement | null) => {
      virtualizer.measureElement(element);
    },
    [virtualizer],
  );
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="codex-panel__message-virtualizer" style={{ height: `${String(virtualizer.getTotalSize())}px` }}>
      {virtualItems.map((virtualItem) => (
        <MessageStreamBlockHost
          key={virtualItem.key}
          block={blocks[virtualItem.index]}
          measureBlock={measureBlock}
          virtualItem={virtualItem}
        />
      ))}
    </div>
  );
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
      {...{ [MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE]: String(virtualItem.index) }}
      style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
    >
      {block.node}
    </div>
  );
}
