import type { ComponentChild as UiNode } from "preact";

import { renderUiRoot } from "../../../../shared/ui/ui-root";
import type { MessageStreamBlock } from "./context";

export function renderMessageStreamBlocks(parent: HTMLElement, blocks: MessageStreamBlock[]): void {
  renderUiRoot(parent, <MessageStreamBlocks blocks={blocks} />);
}

function MessageStreamBlocks({ blocks }: { blocks: MessageStreamBlock[] }): UiNode {
  return (
    <>
      {blocks.map((block) => (
        <MessageStreamBlockHost key={block.key} block={block} />
      ))}
    </>
  );
}

function MessageStreamBlockHost({ block }: { block: MessageStreamBlock }): UiNode {
  return (
    <div className="codex-panel__message-block" data-codex-panel-block-key={block.key}>
      {block.node}
    </div>
  );
}
