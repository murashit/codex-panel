import { describe, expect, it, vi } from "vitest";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { threadStreamItems } from "../../../../../src/features/chat/application/state/thread-stream";
import { chatThreadStreamViewState } from "../../../../../src/features/chat/application/state/turn-scope";
import { activeTurnId, chatTurnBusy } from "../../../../../src/features/chat/application/turns/turn-state";
import type { ThreadStreamItem, UserThreadStreamDialogueItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { chatStateFixture } from "../../support/state";

describe("active turn aggregate", () => {
  it("owns the optimistic, running, child activity, and completed scopes", () => {
    const optimisticItem = userItem("local-user");
    const optimistic = chatReducer(chatStateFixture({ activeThread: { id: "thread" } }), {
      type: "turn/optimistic-started",
      item: optimisticItem,
    });
    expect(optimistic.activeTurn.lifecycle).toEqual({
      kind: "starting",
      anchorItemId: "local-user",
    });
    expect(chatTurnBusy(optimistic.activeTurn)).toBe(true);
    expect(activeTurnId(optimistic.activeTurn)).toBeNull();

    expect(optimistic.activeTurn.activeSegment?.items).toEqual([optimisticItem]);

    const secondOptimisticStart = chatReducer(optimistic, {
      type: "turn/optimistic-started",
      item: userItem("second-local-user"),
    });

    const preAckDelta = chatReducer(secondOptimisticStart, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn-1",
      delta: "working",
    });
    expect(preAckDelta).toBe(secondOptimisticStart);

    const running = chatReducer(preAckDelta, {
      type: "turn/start-acknowledged",
      turnId: "turn-1",
      threadId: "thread",
      anchorItemId: "second-local-user",
    });
    expect(running.activeTurn.lifecycle).toEqual({ kind: "running", turnId: "turn-1" });
    expect(chatTurnBusy(running.activeTurn)).toBe(true);
    expect(activeTurnId(running.activeTurn)).toBe("turn-1");

    const withChild = chatReducer(running, {
      type: "subagent-activity/tracked",
      threadId: "child-thread",
      parentTurnId: "turn-1",
    });
    const withChildTurn = chatReducer(withChild, {
      type: "subagent-activity/runtime-fact",
      threadId: "child-thread",
      fact: { type: "turnStarted", threadId: "child-thread", turnId: "child-turn-1" },
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
    expect(withMoreDelta.threadStream).toBe(withChildTurn.threadStream);
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
      outcome: "completed",
      items: [userItem("local-user", "turn-1"), assistantItem("assistant", "turn-1", "working more")],
    });
    expect(completed.activeTurn.lifecycle).toEqual({ kind: "idle" });
    expect(chatTurnBusy(completed.activeTurn)).toBe(false);
    expect(activeTurnId(completed.activeTurn)).toBeNull();

    expect(completed.activeTurn.activeSegment).toBeNull();
    expect(completed.activeTurn.pendingSteers).toEqual([]);
    expect(completed.activeTurn.subagents.byThreadId).toEqual(new Map());
    expect(completed.activeTurn.authRecovery).toBeNull();
    expect(threadStreamItems(chatThreadStreamViewState(completed.threadStream, completed.activeTurn))).toEqual([
      userItem("local-user", "turn-1"),
      assistantItem("assistant", "turn-1", "working more"),
    ]);
  });

  it("does not publish stream updates that leave the conversation unchanged", () => {
    const store = createChatStateStore(chatStateFixture());
    const listener = vi.fn();
    store.subscribe(listener);
    const item = { id: "log", kind: "system", role: "system", text: "Already reported" } as const;
    store.dispatch({ type: "thread-stream/deduped-log-added", text: item.text, item });
    expect(listener).toHaveBeenCalledOnce();
    listener.mockClear();
    const current = store.getState();

    store.dispatch({ type: "thread-stream/deduped-log-added", text: item.text, item });
    store.dispatch({ type: "thread-stream/pending-steer-removed", clientId: "unknown" });
    store.dispatch({ type: "thread-stream/history-loading-set", loading: false });

    expect(store.getState()).toBe(current);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects stale parent tracking and pending steers after an active turn changes", () => {
    let state = chatStateFixture({ activeThread: { id: "thread" }, activeTurn: { lifecycle: { kind: "running", turnId: "turn-a" } } });
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
    state = chatReducer(state, { type: "turn/completed", turnId: "turn-a", outcome: "completed", items: [] });
    const optimisticItem = userItem("local-user-b");
    state = chatReducer(state, {
      type: "turn/optimistic-started",
      item: optimisticItem,
    });
    state = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "turn-b",
      threadId: "thread",
      anchorItemId: "local-user-b",
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

function userItem(id: string, turnId?: string): UserThreadStreamDialogueItem {
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
