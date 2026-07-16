import { describe, expect, it } from "vitest";
import {
  initialChatThreadStreamState,
  reduceThreadStreamSlice,
  threadStreamItems,
  threadStreamRollbackCandidate,
  threadStreamStartActiveSegment,
  threadStreamTurnsAfterTurnId,
  threadStreamWithActiveTurnItems,
} from "../../../../../src/features/chat/application/state/thread-stream";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("thread stream state", () => {
  it("updates turn diffs and deduplicates reported logs", () => {
    let state = reduceThreadStreamSlice(initialChatThreadStreamState(), {
      type: "thread-stream/turn-diff-updated",
      turnId: "turn",
      diff: "@@",
    });
    const log = { id: "log", kind: "system", role: "system", text: "warning" } satisfies ThreadStreamItem;
    state = reduceThreadStreamSlice(state, { type: "thread-stream/deduped-log-added", text: "warning", item: log });
    state = reduceThreadStreamSlice(state, { type: "thread-stream/deduped-log-added", text: "warning", item: log });

    expect(state.turnDiffs).toEqual(new Map([["turn", "@@"]]));
    expect(threadStreamItems(state)).toEqual([log]);
  });

  it("appends assistant deltas after stable history", () => {
    const history = dialogueItem("history");
    const running = threadStreamStartActiveSegment(initialChatThreadStreamState([history]), "turn", []);
    const next = reduceThreadStreamSlice(running, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "hello",
    });

    expect(threadStreamItems(next)).toEqual([history, expect.objectContaining({ id: "assistant", text: "hello", turnId: "turn" })]);
  });

  it("updates repeated output by source item id without exposing the private index", () => {
    let state = threadStreamStartActiveSegment(initialChatThreadStreamState(), "turn", []);
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "one",
      kind: "command",
      fallbackText: "Command running",
    });
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "two",
      kind: "command",
      fallbackText: "Command running",
    });

    expect(threadStreamItems(state)).toEqual([expect.objectContaining({ id: "cmd", output: "onetwo" })]);
  });

  it("ignores deltas from a different active turn", () => {
    let state = threadStreamStartActiveSegment(initialChatThreadStreamState(), "turn-active", []);
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn-active",
      delta: "active",
    });
    const next = reduceThreadStreamSlice(state, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "stale",
      turnId: "turn-stale",
      delta: "stale",
    });

    expect(threadStreamItems(next)).toEqual([expect.objectContaining({ id: "assistant", text: "active" })]);
  });

  it("keeps optimistic items when the active turn is acknowledged by a delta", () => {
    const optimistic = threadStreamStartActiveSegment(initialChatThreadStreamState(), null, [dialogueItem("local-user")]);
    const next = reduceThreadStreamSlice(optimistic, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "ack",
    });

    expect(threadStreamItems(next)).toEqual([
      expect.objectContaining({ id: "local-user" }),
      expect.objectContaining({ id: "assistant", text: "ack", turnId: "turn" }),
    ]);
  });

  it("appends text only when an existing source item has the same kind", () => {
    let state = threadStreamStartActiveSegment(initialChatThreadStreamState(), "turn", []);
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-text-appended",
      itemId: "shared-source",
      turnId: "turn",
      label: "Tool",
      delta: "tool text",
      kind: "tool",
    });
    const mismatched = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-text-appended",
      itemId: "shared-source",
      turnId: "turn",
      label: "Reasoning",
      delta: "reasoning text",
      kind: "reasoning",
    });
    const matching = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-text-appended",
      itemId: "shared-source",
      turnId: "turn",
      label: "Tool",
      delta: " more",
      kind: "tool",
    });

    expect(threadStreamItems(mismatched)).toEqual([expect.objectContaining({ kind: "tool", text: "Tool: tool text" })]);
    expect(threadStreamItems(matching)).toEqual([expect.objectContaining({ kind: "tool", text: "Tool: tool text more" })]);
  });
});

describe("thread stream selectors", () => {
  it("counts turns after a turn id from thread stream state", () => {
    const state = initialChatThreadStreamState(items());

    expect(threadStreamTurnsAfterTurnId(state, "turn-1")).toBe(2);
    expect(threadStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
    expect(threadStreamTurnsAfterTurnId(state, "turn-3")).toBe(0);
    expect(threadStreamTurnsAfterTurnId(state, "missing")).toBeNull();
  });

  it("includes the active segment when counting turns", () => {
    const state = threadStreamWithActiveTurnItems(initialChatThreadStreamState(items()), "turn-3", items());

    expect(threadStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
  });

  it("selects the latest turn user dialogue for rollback restoration", () => {
    const state = initialChatThreadStreamState(items());

    expect(threadStreamRollbackCandidate(state)).toEqual({ turnId: "turn-3", itemId: "u3", text: "third" });
  });

  it("uses the semantic prompt instead of steering dialogues for rollback restoration", () => {
    const state = initialChatThreadStreamState([
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "initial", turnId: "turn-1" },
      { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "steer", turnId: "turn-1", clientId: "local-steer-1" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "turn-1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);

    expect(threadStreamRollbackCandidate(state)).toEqual({ turnId: "turn-1", itemId: "u1", text: "initial" });
  });

  it("restores raw user dialogue text instead of rendered display text", () => {
    const state = initialChatThreadStreamState([
      {
        id: "u1",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "Use `$obsidian-codex-panel-maintain`.",
        copyText: "Use $obsidian-codex-panel-maintain.",
        turnId: "turn-1",
      },
    ]);

    expect(threadStreamRollbackCandidate(state)).toEqual({
      turnId: "turn-1",
      itemId: "u1",
      text: "Use $obsidian-codex-panel-maintain.",
    });
  });

  it("returns null when rollback has no user dialogue candidate", () => {
    expect(threadStreamRollbackCandidate(initialChatThreadStreamState([]))).toBeNull();
  });
});

function dialogueItem(id: string): ThreadStreamItem {
  return { id, kind: "dialogue", role: "assistant", text: id, dialogueKind: "assistantResponse", dialogueState: "completed" };
}

function items(): ThreadStreamItem[] {
  return [
    { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "first", turnId: "turn-1" },
    {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      text: "first answer",
      turnId: "turn-1",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "tool-1", kind: "tool", role: "tool", text: "work", turnId: "turn-2" },
    {
      id: "a2",
      kind: "dialogue",
      role: "assistant",
      text: "second answer",
      turnId: "turn-2",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "third", turnId: "turn-3" },
  ];
}
