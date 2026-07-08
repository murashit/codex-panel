import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { threadStreamItems, threadStreamWithItems } from "../../../../src/features/chat/application/state/thread-stream";
import type { ThreadStreamItem } from "../../../../src/features/chat/domain/thread-stream/items";
import { chatStateWith } from "./state";

export function chatStateThreadStreamItems(state: Pick<ChatState, "threadStream">): readonly ThreadStreamItem[] {
  return threadStreamItems(state.threadStream);
}

export function withChatStateThreadStreamItems(state: ChatState, items: readonly ThreadStreamItem[]): ChatState {
  return chatStateWith(state, {
    threadStream: threadStreamWithItems(state.threadStream, items),
  });
}
