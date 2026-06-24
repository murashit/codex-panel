import { messageStreamItems, messageStreamWithItems } from "../../../../src/features/chat/application/state/message-stream";
import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";
import { chatStateWith } from "./state";

export function chatStateMessageStreamItems(state: Pick<ChatState, "messageStream">): readonly MessageStreamItem[] {
  return messageStreamItems(state.messageStream);
}

export function withChatStateMessageStreamItems(state: ChatState, items: readonly MessageStreamItem[]): ChatState {
  return chatStateWith(state, {
    messageStream: messageStreamWithItems(state.messageStream, items),
  });
}
