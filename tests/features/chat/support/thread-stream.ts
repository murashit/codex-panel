import type { ChatState } from "../../../../src/features/chat/application/state/model";
import { threadStreamItems, threadStreamWithItems } from "../../../../src/features/chat/application/state/thread-stream";
import { chatThreadStreamViewState } from "../../../../src/features/chat/application/state/turn-scope";
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

export function taskProgressFixture(
  turnId: string,
  overrides: Partial<Extract<ThreadStreamItem, { kind: "taskProgress" }>> = {},
): Extract<ThreadStreamItem, { kind: "taskProgress" }> {
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    explanation: null,
    steps: [{ step: "Keep this", status: "completed" }],
    executionState: "completed",
    ...overrides,
  };
}
