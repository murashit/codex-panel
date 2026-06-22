import type { ComponentChild as UiNode } from "preact";

import { MessageStreamFlowFrame, type MessageStreamScrollControllerBinding } from "./flow-scroll";
import type { MessageStreamContext } from "./context";
import { MessageStreamBlockContent } from "./stream-blocks";
import type { MessageStreamViewBlock } from "../../presentation/message-stream/view-model";

export interface MessageStreamViewportState {
  blocks: readonly MessageStreamViewBlock[];
  context: MessageStreamContext;
  scrollController: MessageStreamScrollControllerBinding;
}

export interface MessageStreamViewportProps {
  state: MessageStreamViewportState;
  rootAttributes?: Partial<Record<`data-${string}`, string>>;
}

export function MessageStreamViewport({ state, rootAttributes }: MessageStreamViewportProps): UiNode {
  const { blocks, context, scrollController } = state;
  return (
    <MessageStreamFlowFrame
      blocks={blocks}
      scrollController={scrollController}
      renderBlockContent={(block) => <MessageStreamBlockContent block={block} context={context} />}
      {...(rootAttributes ? { rootAttributes } : {})}
    />
  );
}
