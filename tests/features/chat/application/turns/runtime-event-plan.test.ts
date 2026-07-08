import { describe, expect, it } from "vitest";
import { type ChatAction, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { planTurnRuntimeEvents } from "../../../../../src/features/chat/application/turns/runtime-event-plan";
import type { TurnRuntimeEvent } from "../../../../../src/features/chat/application/turns/runtime-events";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateThreadStreamItems } from "../../support/thread-stream";

function activeRunningState(): ChatState {
  let state = chatStateFixture();
  state = chatStateWith(state, { activeThread: { id: "thread-active" } });
  return chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
}

function applyActions(state: ChatState, actions: readonly ChatAction[]): ChatState {
  return actions.reduce(chatReducer, state);
}

describe("TurnRuntimeEvent planner", () => {
  it("reports turn starts as turn-runtime outcomes", () => {
    const state = chatStateWith(chatStateFixture(), { activeThread: { id: "thread-active" } });

    const plan = planTurnRuntimeEvents(state, [{ type: "turnStarted", threadId: "thread-active", turnId: "turn-active", recencyAt: 123 }]);

    expect(plan.outcomes).toEqual([{ type: "turn-started", threadId: "thread-active", turnId: "turn-active", recencyAt: 123 }]);
  });

  it("reconciles completed turn snapshots with optimistic local user messages", () => {
    let state = activeRunningState();
    state = withChatStateThreadStreamItems(state, [
      { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello", turnId: "turn-active" },
    ]);
    const events: TurnRuntimeEvent[] = [
      {
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "completed",
        completedSummary: { userText: "hello", assistantText: "done" },
        completedItems: [
          {
            id: "u1",
            sourceItemId: "u1",
            kind: "dialogue",
            dialogueKind: "user",
            role: "user",
            text: "hello",
            clientId: "local-user-1",
            turnId: "turn-active",
          },
          {
            id: "a1",
            sourceItemId: "a1",
            kind: "dialogue",
            dialogueKind: "assistantResponse",
            role: "assistant",
            text: "done",
            dialogueState: "completed",
            turnId: "turn-active",
          },
        ],
      },
    ];

    const plan = planTurnRuntimeEvents(state, events);
    const next = applyActions(state, plan.actions);

    expect(chatStateThreadStreamItems(next).map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(plan.outcomes).toEqual([
      {
        type: "turn-completed",
        threadId: "thread-active",
        turnId: "turn-active",
        completedSummary: { userText: "hello", assistantText: "done" },
      },
    ]);
  });

  it("upserts structured auto-review results without dropping unrelated stream items", () => {
    let state = activeRunningState();
    state = withChatStateThreadStreamItems(state, [
      { id: "m1", kind: "dialogue", dialogueKind: "assistantResponse", role: "assistant", text: "working", dialogueState: "completed" },
      { id: "warning-1", kind: "reviewResult", role: "tool", text: "Auto-review warning", executionState: "completed" },
    ]);
    const item: ThreadStreamItem = {
      id: "review-1",
      kind: "reviewResult",
      role: "tool",
      text: "Auto-review approved",
      turnId: "turn-active",
      executionState: "completed",
    };

    const plan = planTurnRuntimeEvents(state, [{ type: "autoReviewUpdated", item }]);
    const next = applyActions(state, plan.actions);

    expect(chatStateThreadStreamItems(next).map((streamItem) => streamItem.id)).toEqual(["m1", "review-1"]);
  });
});
