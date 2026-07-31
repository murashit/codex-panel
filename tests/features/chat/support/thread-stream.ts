import { chatThreadStreamViewState } from "../../../../src/features/chat/application/state/active-turn";
import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { threadStreamItems, threadStreamWithItems } from "../../../../src/features/chat/application/state/thread-stream";
import type { ThreadStreamItem } from "../../../../src/features/chat/domain/thread-stream/items";
import { chatStateWith } from "./state";

export function chatStateThreadStreamItems(state: Pick<ChatState, "threadStream" | "activeTurn">): readonly ThreadStreamItem[] {
  return threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn));
}

/** Replaces stable history while intentionally preserving active-turn transient state. */
export function withChatStateStableThreadStreamItems(state: ChatState, items: readonly ThreadStreamItem[]): ChatState {
  return chatStateWith(state, {
    threadStream: threadStreamWithItems(state.threadStream, items),
  });
}
