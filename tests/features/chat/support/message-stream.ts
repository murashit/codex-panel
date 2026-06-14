import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";
import { messageStreamItems, messageStreamWithItems } from "../../../../src/features/chat/application/state/message-stream";
import type { ChatState } from "../../../../src/features/chat/application/state/reducer";

export function chatStateMessageStreamItems(state: Pick<ChatState, "messageStream">): readonly MessageStreamItem[] {
  return messageStreamItems(state.messageStream);
}

export function setChatStateMessageStreamItems(state: ChatState, items: readonly MessageStreamItem[]): void {
  state.messageStream = messageStreamWithItems(state.messageStream, items);
}
