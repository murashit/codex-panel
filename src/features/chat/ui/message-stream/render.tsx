import type { ComponentChild as UiNode } from "preact";
import { useCallback, useLayoutEffect, useState } from "preact/hooks";

import { renderUiRoot } from "../../../../shared/ui/ui-root";
import { MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE, type MessageStreamVirtualizer } from "../message-virtualizer";
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
  if (!block) return null;

  return (
    <div
      ref={measureBlock}
      className="codex-panel__message-block"
      data-codex-panel-block-key={block.key}
      {...{ [MESSAGE_VIRTUAL_ITEM_INDEX_ATTRIBUTE]: String(virtualItem.index) }}
      style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
    >
      {block.node}
    </div>
  );
}
