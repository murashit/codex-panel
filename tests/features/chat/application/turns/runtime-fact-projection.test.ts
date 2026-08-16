import { describe, expect, it } from "vitest";
import type { ChatState } from "../../../../../src/features/chat/application/state/model";
import { type ChatAction, chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { projectTurnRuntimeFacts } from "../../../../../src/features/chat/application/turns/runtime-fact-projection";
import type { TurnRuntimeFact } from "../../../../../src/features/chat/application/turns/runtime-facts";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateStableThreadStreamItems } from "../../support/thread-stream";

function activeRunningState(): ChatState {
  let state = chatStateFixture();
  state = chatStateWith(state, { activeThread: { id: "thread-active" } });
  return chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
}

function applyActions(state: ChatState, actions: readonly ChatAction[]): ChatState {
  return actions.reduce(chatReducer, state);
}

describe("TurnRuntimeFact projection", () => {
  it("projects turn starts without completion outcomes", () => {
    const state = chatStateWith(chatStateFixture(), { activeThread: { id: "thread-active" } });

    const projection = projectTurnRuntimeFacts(state, [{ type: "turnStarted", threadId: "thread-active", turnId: "turn-active" }]);

    expect(projection.outcomes).toEqual([]);
  });

  it("reconciles completed turn snapshots with optimistic local user dialogues", () => {
    let state = activeRunningState();
    state = withChatStateStableThreadStreamItems(state, [
      { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello", turnId: "turn-active" },
    ]);
    const facts: TurnRuntimeFact[] = [
      {
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "completed",
        itemsView: "full",
        completedTurnTranscriptSummary: { userText: "hello", assistantText: "done" },
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

    const projection = projectTurnRuntimeFacts(state, facts);
    const next = applyActions(state, projection.actions);

    expect(chatStateThreadStreamItems(next).map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(projection.outcomes).toEqual([
      {
        type: "turn-completed",
        threadId: "thread-active",
        turnId: "turn-active",
        completedTurnTranscriptSummary: { userText: "hello", assistantText: "done" },
      },
    ]);
  });

  it("commits only the pending steer matched by an observed user-message client id", () => {
    let state = activeRunningState();
    state = chatReducer(state, {
      type: "thread-stream/pending-steer-added",
      item: {
        id: "local-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-active",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      },
    });

    const projection = projectTurnRuntimeFacts(state, [
      {
        type: "userMessageObserved",
        item: {
          id: "server-steer",
          clientId: "local-steer",
          sourceItemId: "server-steer",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "follow up",
          turnId: "turn-active",
        },
      },
    ]);
    const next = applyActions(state, projection.actions);

    expect(next.activeTurn.pendingSteers).toEqual([]);
    expect(chatStateThreadStreamItems(next)).toEqual([
      expect.objectContaining({
        id: "server-steer",
        clientId: "local-steer",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      }),
    ]);
  });

  it("treats normal completion items as a summary and clears pending separately", () => {
    let state = activeRunningState();
    state = withChatStateStableThreadStreamItems(state, [
      {
        id: "before",
        sourceItemId: "before",
        kind: "dialogue",
        dialogueKind: "assistantResponse",
        role: "assistant",
        text: "before",
        dialogueState: "completed",
        turnId: "turn-active",
      },
    ]);
    state = chatReducer(state, {
      type: "thread-stream/pending-steer-added",
      item: {
        id: "local-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-active",
      },
    });

    const projection = projectTurnRuntimeFacts(state, [
      {
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "completed",
        itemsView: "summary",
        completedTurnTranscriptSummary: { userText: null, assistantText: "done" },
        completedItems: [
          {
            id: "assistant",
            sourceItemId: "assistant",
            kind: "dialogue",
            dialogueKind: "assistantResponse",
            role: "assistant",
            text: "done",
            dialogueState: "completed",
            turnId: "turn-active",
          },
        ],
      },
    ]);
    const next = applyActions(state, projection.actions);

    expect(next.activeTurn.pendingSteers).toEqual([]);
    expect(chatStateThreadStreamItems(next)).toEqual([
      expect.objectContaining({ id: "before" }),
      expect.objectContaining({ id: "assistant" }),
    ]);
  });

  it("clears pending steers when a terminal fact has no item payload", () => {
    let state = activeRunningState();
    state = chatReducer(state, {
      type: "thread-stream/pending-steer-added",
      item: {
        id: "local-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-active",
      },
    });

    const projection = projectTurnRuntimeFacts(state, [
      {
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "interrupted",
        itemsView: "notLoaded",
        completedTurnTranscriptSummary: null,
        completedItems: [],
      },
    ]);
    const next = applyActions(state, projection.actions);

    expect(next.activeTurn.pendingSteers).toEqual([]);
  });

  it("upserts structured auto-review results without dropping unrelated stream items", () => {
    let state = activeRunningState();
    state = withChatStateStableThreadStreamItems(state, [
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

    const projection = projectTurnRuntimeFacts(state, [{ type: "autoReviewUpdated", item }]);
    const next = applyActions(state, projection.actions);

    expect(chatStateThreadStreamItems(next).map((streamItem) => streamItem.id)).toEqual(["m1", "review-1"]);
  });
});
