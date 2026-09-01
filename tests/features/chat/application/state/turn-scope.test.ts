import { describe, expect, it } from "vitest";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { threadStreamItems } from "../../../../../src/features/chat/application/state/thread-stream";
import { chatThreadStreamViewState } from "../../../../../src/features/chat/application/state/turn-scope";
import { activeTurnId, chatTurnBusy, pendingTurnStart } from "../../../../../src/features/chat/application/turns/turn-state";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { chatStateFixture } from "../../support/state";

describe("active turn aggregate", () => {
  it("owns the optimistic, running, child activity, and completed scopes", () => {
    const optimisticItem = userItem("local-user");
    const optimistic = chatReducer(chatStateFixture(), {
      type: "turn/optimistic-started",
      item: optimisticItem,
      pendingTurnStart: { anchorItemId: optimisticItem.id, promptSubmitHookItemIds: [] },
    });
    const optimisticRevision = optimistic.activeTurn.turnScopeRevision;
    expect(optimistic.activeTurn.lifecycle).toEqual({
      kind: "starting",
      pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
    });
    expect(chatTurnBusy(optimistic.activeTurn)).toBe(true);
    expect(activeTurnId(optimistic.activeTurn)).toBeNull();
    expect(pendingTurnStart(optimistic.activeTurn)).toEqual({ anchorItemId: "local-user", promptSubmitHookItemIds: [] });
    expect(optimistic.activeTurn.activeSegment?.items).toEqual([optimisticItem]);

    const withPromptHook = chatReducer(optimistic, {
      type: "turn/pending-start-hook-upserted",
      item: { id: "prompt-hook", kind: "hook", role: "tool", text: "prompt" },
      pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["prompt-hook"] },
    });
    expect(withPromptHook.activeTurn.turnScopeRevision).toBe(optimisticRevision);

    const secondOptimisticStart = chatReducer(withPromptHook, {
      type: "turn/optimistic-started",
      item: userItem("second-local-user"),
      pendingTurnStart: { anchorItemId: "second-local-user", promptSubmitHookItemIds: [] },
    });
    const secondOptimisticRevision = secondOptimisticStart.activeTurn.turnScopeRevision;
    expect(secondOptimisticRevision).toBe(optimisticRevision + 1);

    const preAckDelta = chatReducer(secondOptimisticStart, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn-1",
      delta: "working",
    });
    expect(preAckDelta.activeTurn.turnScopeRevision).toBe(secondOptimisticRevision);
    expect(preAckDelta).toBe(secondOptimisticStart);

    const running = chatReducer(preAckDelta, {
      type: "turn/start-acknowledged",
      turnId: "turn-1",
      items: [userItem("local-user", "turn-1"), assistantItem("assistant", "turn-1", "working")],
    });
    const runningRevision = running.activeTurn.turnScopeRevision;
    expect(running.activeTurn.lifecycle).toEqual({ kind: "running", turnId: "turn-1" });
    expect(chatTurnBusy(running.activeTurn)).toBe(true);
    expect(activeTurnId(running.activeTurn)).toBe("turn-1");
    expect(pendingTurnStart(running.activeTurn)).toBeNull();
    expect(runningRevision).toBe(secondOptimisticRevision + 1);

    const duplicateAcknowledgement = chatReducer(running, {
      type: "turn/start-acknowledged",
      turnId: "turn-1",
      items: [userItem("local-user", "turn-1"), assistantItem("assistant", "turn-1", "working")],
    });
    expect(duplicateAcknowledgement.activeTurn.turnScopeRevision).toBe(runningRevision);

    const withChild = chatReducer(running, {
      type: "subagent-activity/tracked",
      threadId: "child-thread",
      parentTurnId: "turn-1",
    });
    const withChildTurn = chatReducer(withChild, {
      type: "subagent-activity/turn-started",
      threadId: "child-thread",
      childTurnId: "child-turn-1",
    });
    expect(withChildTurn.activeTurn.subagents.byThreadId.get("child-thread")).toMatchObject({
      childTurnId: "child-turn-1",
      liveness: "running",
      outcome: null,
    });

    const withMoreDelta = chatReducer(withChildTurn, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn-1",
      delta: " more",
    });
    expect(withMoreDelta.activeTurn.turnScopeRevision).toBe(runningRevision);
    expect(withMoreDelta.activeTurn.subagents.byThreadId.has("child-thread")).toBe(true);

    const withAuthRecovery = chatReducer(withMoreDelta, {
      type: "auth-recovery/updated",
      turnId: "turn-1",
      progress: {
        message: "Authentication refreshed.",
        phase: "completed",
      },
    });
    expect(withAuthRecovery.activeTurn.authRecovery).toMatchObject({ phase: "completed" });

    const stale = chatReducer(withAuthRecovery, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "stale-assistant",
      turnId: "old-turn",
      delta: "stale",
    });
    expect(stale).toBe(withAuthRecovery);

    const completed = chatReducer(withAuthRecovery, {
      type: "turn/completed",
      turnId: "turn-1",
      status: "completed",
      items: [userItem("local-user", "turn-1"), assistantItem("assistant", "turn-1", "working more")],
    });
    expect(completed.activeTurn.lifecycle).toEqual({ kind: "idle" });
    expect(chatTurnBusy(completed.activeTurn)).toBe(false);
    expect(activeTurnId(completed.activeTurn)).toBeNull();
    expect(pendingTurnStart(completed.activeTurn)).toBeNull();
    expect(completed.activeTurn.turnScopeRevision).toBe(runningRevision + 1);
    expect(completed.activeTurn.activeSegment).toBeNull();
    expect(completed.activeTurn.pendingSteers).toEqual([]);
    expect(completed.activeTurn.subagents.byThreadId).toEqual(new Map());
    expect(completed.activeTurn.authRecovery).toBeNull();
    expect(threadStreamItems(chatThreadStreamViewState(completed.threadStream, completed.activeTurn))).toEqual([
      userItem("local-user", "turn-1"),
      assistantItem("assistant", "turn-1", "working more"),
    ]);
  });

  it("rejects stale parent tracking and pending steers after an active turn changes", () => {
    let state = chatStateFixture({ activeTurn: { lifecycle: { kind: "running", turnId: "turn-a" } } });
    state = chatReducer(state, {
      type: "thread-stream/pending-steer-added",
      item: {
        id: "local-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-a",
      },
    });
    state = chatReducer(state, { type: "turn/completed", turnId: "turn-a", status: "completed", items: [] });
    const optimisticItem = userItem("local-user-b");
    state = chatReducer(state, {
      type: "turn/optimistic-started",
      item: optimisticItem,
      pendingTurnStart: { anchorItemId: optimisticItem.id, promptSubmitHookItemIds: [] },
    });
    state = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "turn-b",
      items: [userItem("local-user-b", "turn-b")],
    });

    const staleParent = chatReducer(state, {
      type: "subagent-activity/tracked",
      threadId: "old-child",
      parentTurnId: "old-parent",
    });
    expect(staleParent).toBe(state);
    expect(staleParent.activeTurn.subagents.byThreadId).toEqual(new Map());

    const stale = chatReducer(staleParent, {
      type: "thread-stream/pending-steer-committed",
      item: {
        id: "server-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-a",
      },
    });

    expect(stale).toBe(state);
  });
});

function userItem(id: string, turnId?: string): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text: id,
    ...(turnId ? { turnId } : {}),
  };
}

function assistantItem(id: string, turnId: string, text: string): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text,
    turnId,
    dialogueState: "streaming",
  };
}
