import type { DisplayItem } from "../../../../src/features/chat/display/types";
import { messageStreamDisplayItems, messageStreamWithDisplayItems } from "../../../../src/features/chat/state/message-stream";
import type { ChatState } from "../../../../src/features/chat/state/reducer";

export function chatStateDisplayItems(state: Pick<ChatState, "messageStream">): readonly DisplayItem[] {
  return messageStreamDisplayItems(state.messageStream);
}

export function setChatStateDisplayItems(state: ChatState, items: readonly DisplayItem[]): void {
  state.messageStream = messageStreamWithDisplayItems(state.messageStream, items);
}
