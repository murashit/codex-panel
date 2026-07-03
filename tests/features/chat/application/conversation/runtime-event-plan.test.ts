import { describe, expect, it } from "vitest";
import { planConversationRuntimeEvents } from "../../../../../src/features/chat/application/conversation/runtime-event-plan";
import type { ConversationRuntimeEvent } from "../../../../../src/features/chat/application/conversation/runtime-events";
import { type ChatAction, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "../../support/message-stream";
import { chatStateFixture, chatStateWith } from "../../support/state";

function activeRunningState(): ChatState {
  let state = chatStateFixture();
  state = chatStateWith(state, { activeThread: { id: "thread-active" } });
  return chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
}

function applyActions(state: ChatState, actions: readonly ChatAction[]): ChatState {
  return actions.reduce(chatReducer, state);
}

describe("ConversationRuntimeEvent planner", () => {
  it("keeps run recency updates as conversation-owned effects", () => {
    const state = chatStateWith(chatStateFixture(), { activeThread: { id: "thread-active" } });

    const plan = planConversationRuntimeEvents(state, [
      { type: "runStarted", threadId: "thread-active", runId: "turn-active", recencyAt: 123 },
    ]);

    expect(plan.effects).toEqual([{ type: "thread-recency-touched", threadId: "thread-active", recencyAt: 123 }]);
  });

  it("reconciles completed run snapshots with optimistic local user messages", () => {
    let state = activeRunningState();
    state = withChatStateMessageStreamItems(state, [
      { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello", turnId: "turn-active" },
    ]);
    const events: ConversationRuntimeEvent[] = [
      {
        type: "runCompleted",
        threadId: "thread-active",
        runId: "turn-active",
        status: "completed",
        completedSummary: { userText: "hello", assistantText: "done" },
        completedItems: [
          {
            id: "u1",
            sourceItemId: "u1",
            kind: "message",
            messageKind: "user",
            role: "user",
            text: "hello",
            clientId: "local-user-1",
            turnId: "turn-active",
          },
          {
            id: "a1",
            sourceItemId: "a1",
            kind: "message",
            messageKind: "assistantResponse",
            role: "assistant",
            text: "done",
            messageState: "completed",
            turnId: "turn-active",
          },
        ],
      },
    ];

    const plan = planConversationRuntimeEvents(state, events);
    const next = applyActions(state, plan.actions);

    expect(chatStateMessageStreamItems(next).map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(plan.effects).toEqual([
      {
        type: "maybe-name-thread",
        threadId: "thread-active",
        turnId: "turn-active",
        completedSummary: { userText: "hello", assistantText: "done" },
      },
      { type: "refresh-threads" },
    ]);
  });

  it("upserts structured auto-review results without dropping unrelated stream items", () => {
    let state = activeRunningState();
    state = withChatStateMessageStreamItems(state, [
      { id: "m1", kind: "message", messageKind: "assistantResponse", role: "assistant", text: "working", messageState: "completed" },
      { id: "warning-1", kind: "reviewResult", role: "tool", text: "Auto-review warning", executionState: "completed" },
    ]);
    const item: MessageStreamItem = {
      id: "review-1",
      kind: "reviewResult",
      role: "tool",
      text: "Auto-review approved",
      turnId: "turn-active",
      executionState: "completed",
    };

    const plan = planConversationRuntimeEvents(state, [{ type: "autoReviewUpdated", item }]);
    const next = applyActions(state, plan.actions);

    expect(chatStateMessageStreamItems(next).map((streamItem) => streamItem.id)).toEqual(["m1", "review-1"]);
  });
});
