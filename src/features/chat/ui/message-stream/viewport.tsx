import type { ComponentChild as UiNode } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import { type MessageStreamScrollControllerBinding, useMessageStreamFlowScroll } from "./flow-scroll";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "./content-events";
import type { MessageStreamBlock } from "./context";

export interface MessageStreamViewportState {
  blocks: MessageStreamBlock[];
  scrollController: MessageStreamScrollControllerBinding;
}

export interface MessageStreamViewportProps {
  state: MessageStreamViewportState;
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
}

export function MessageStreamViewport({ state, rootAttributes }: MessageStreamViewportProps): UiNode {
  const { blocks, scrollController } = state;
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const flowScroll = useMessageStreamFlowScroll({ blocks, scrollController, scrollElementRef });
  const notifyBlockLayout = useCallback(
    (element: HTMLElement | null) => {
      flowScroll.notifyBlockLayout(element);
    },
    [flowScroll],
  );

  return (
    <div
      {...rootAttributes}
      ref={scrollElementRef}
      className="codex-panel__region codex-panel__region--message-stream codex-panel__messages"
    >
      <div className="codex-panel__message-flow">
        {blocks.map((block, index) => (
          <MessageStreamBlockHost key={block.key} block={block} notifyBlockLayout={notifyBlockLayout} index={index} />
        ))}
      </div>
    </div>
  );
}

function MessageStreamBlockHost({
  block,
  index,
  notifyBlockLayout,
}: {
  block: MessageStreamBlock;
  index: number;
  notifyBlockLayout: (element: HTMLElement | null) => void;
}): UiNode {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const cleanupBlockListeners = useRef<(() => void) | null>(null);
  const setBlock = useCallback(
    (element: HTMLDivElement | null) => {
      cleanupBlockListeners.current?.();
      cleanupBlockListeners.current = null;
      blockRef.current = element;
      notifyBlockLayout(element);
      if (!element) return;
      const notifyLayoutChange = () => {
        if (blockRef.current === element && element.isConnected) notifyBlockLayout(element);
      };
      element.addEventListener("toggle", notifyLayoutChange, true);
      element.addEventListener(MESSAGE_CONTENT_RENDERED_EVENT, notifyLayoutChange, true);
      cleanupBlockListeners.current = () => {
        element.removeEventListener("toggle", notifyLayoutChange, true);
        element.removeEventListener(MESSAGE_CONTENT_RENDERED_EVENT, notifyLayoutChange, true);
      };
    },
    [notifyBlockLayout],
  );

  useLayoutEffect(() => {
    const element = blockRef.current;
    if (element?.isConnected) notifyBlockLayout(element);
  }, [block, notifyBlockLayout]);

  useLayoutEffect(() => {
    return () => {
      cleanupBlockListeners.current?.();
      cleanupBlockListeners.current = null;
    };
  }, []);

  return (
    <div ref={setBlock} className="codex-panel__message-block" data-codex-panel-block-key={block.key} data-index={String(index)}>
      {block.node}
    </div>
  );
}
