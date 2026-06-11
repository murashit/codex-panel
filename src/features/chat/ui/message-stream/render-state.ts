import type { ChatState } from "../../state/reducer";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../message-virtualizer";
import { messageStreamBlocks } from "./blocks";
import { createMessageStreamContext, type ChatMessageStreamContextPort } from "./context-builder";
import type { MessageStreamRenderState } from "./render";

export interface MessageStreamRenderStateOptions {
  state: ChatState;
  contextPort: ChatMessageStreamContextPort;
  consumeScrollIntent: () => MessageStreamScrollIntent;
  registerVirtualizer: (virtualizer: MessageStreamVirtualizerHandle) => () => void;
}

export function createMessageStreamRenderState(options: MessageStreamRenderStateOptions): MessageStreamRenderState {
  return {
    blocks: messageStreamBlocks(createMessageStreamContext(options.state, options.contextPort)),
    consumeScrollIntent: options.consumeScrollIntent,
    registerVirtualizer: options.registerVirtualizer,
  };
}
