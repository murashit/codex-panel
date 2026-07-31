import { describe, expect, it } from "vitest";
import { chatThreadStreamViewState, initialChatActiveTurnState } from "../../../../../src/features/chat/application/state/active-turn";
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
    let state = reduceThreadStreamSlice(initialView(), {
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
    const running = threadStreamStartActiveSegment(initialView([history]), "turn", []);
    const next = reduceThreadStreamSlice(running, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "hello",
    });

    expect(threadStreamItems(next)).toEqual([history, expect.objectContaining({ id: "assistant", text: "hello", turnId: "turn" })]);
  });

  it("keeps pending steers outside canonical stream items until the server observes them", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn", [dialogueItem("prompt")]);
    const pending = {
      id: "local-steer",
      clientId: "local-steer",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "follow up",
      turnId: "turn",
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    } satisfies Extract<ThreadStreamItem, { dialogueKind: "user" }>;
    state = reduceThreadStreamSlice(state, { type: "thread-stream/pending-steer-added", item: pending });
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "working",
    });

    expect(threadStreamItems(state).map((item) => item.id)).toEqual(["prompt", "assistant"]);
    expect(state.pendingSteers).toEqual([pending]);

    const committed = reduceThreadStreamSlice(state, {
      type: "thread-stream/pending-steer-committed",
      item: {
        id: "server-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn",
      },
    });

    expect(committed.pendingSteers).toEqual([]);
    expect(threadStreamItems(committed)).toEqual([
      expect.objectContaining({ id: "prompt" }),
      expect.objectContaining({ id: "assistant" }),
      expect.objectContaining({
        id: "server-steer",
        clientId: "local-steer",
        referencedFiles: [{ name: "Note", path: "Note.md" }],
      }),
    ]);
  });

  it("does not carry pending steers into a different active turn", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn-old", []);
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/pending-steer-added",
      item: {
        id: "local-steer",
        clientId: "local-steer",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn-old",
      },
    });

    const next = threadStreamStartActiveSegment(state, "turn-new", []);

    expect(next.pendingSteers).toEqual([]);
  });

  it("commits one pending steer without disturbing the remaining FIFO order", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn", []);
    for (const clientId of ["first", "second", "third"]) {
      state = reduceThreadStreamSlice(state, {
        type: "thread-stream/pending-steer-added",
        item: {
          id: clientId,
          clientId,
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: clientId,
          turnId: "turn",
        },
      });
    }

    const next = reduceThreadStreamSlice(state, {
      type: "thread-stream/pending-steer-committed",
      item: {
        id: "server-second",
        clientId: "second",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "second",
        turnId: "turn",
      },
    });

    expect(next.pendingSteers.map((item) => item.clientId)).toEqual(["first", "third"]);
    expect(threadStreamItems(next).map((item) => item.id)).toEqual(["server-second"]);
  });

  it("updates repeated output by source item id without exposing the private index", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn", []);
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

  it("keeps v2 activity correlation separate from a dynamic tool with the same protocol id", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn", []);
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/item-upserted",
      item: {
        id: "subagent-activity:spawn-call",
        sourceItemId: "subagent-activity:spawn-call",
        kind: "agent",
        role: "tool",
        turnId: "turn",
        action: "spawn",
        coordinationUpdate: "started",
        status: "started",
        senderThreadId: null,
        targets: [{ threadId: "child-thread", label: "/root/scout" }],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [],
      },
    });
    state = reduceThreadStreamSlice(state, {
      type: "thread-stream/tool-output-appended",
      itemId: "spawn-call",
      turnId: "turn",
      delta: "spawned",
      fallbackLabel: "spawn_agent",
    });

    expect(threadStreamItems(state)).toEqual([
      expect.objectContaining({ id: "subagent-activity:spawn-call", kind: "agent" }),
      expect.objectContaining({ id: "spawn-call", kind: "tool", output: "spawned" }),
    ]);
  });

  it("ignores deltas from a different active turn", () => {
    let state = threadStreamStartActiveSegment(initialView(), "turn-active", []);
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
    const optimistic = threadStreamStartActiveSegment(initialView(), null, [dialogueItem("local-user")]);
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
    let state = threadStreamStartActiveSegment(initialView(), "turn", []);
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
    const view = chatThreadStreamViewState(state, initialChatActiveTurnState());

    expect(threadStreamTurnsAfterTurnId(view, "turn-1")).toBe(2);
    expect(threadStreamTurnsAfterTurnId(view, "turn-2")).toBe(1);
    expect(threadStreamTurnsAfterTurnId(view, "turn-3")).toBe(0);
    expect(threadStreamTurnsAfterTurnId(view, "missing")).toBeNull();
  });

  it("includes the active segment when counting turns", () => {
    const state = threadStreamWithActiveTurnItems(initialView(items()), "turn-3", items());

    expect(threadStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
  });

  it("selects the latest turn user dialogue for rollback restoration", () => {
    const state = initialChatThreadStreamState(items());

    expect(threadStreamRollbackCandidate(chatThreadStreamViewState(state, initialChatActiveTurnState()))).toEqual({
      turnId: "turn-3",
      itemId: "u3",
      text: "third",
    });
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

    expect(threadStreamRollbackCandidate(chatThreadStreamViewState(state, initialChatActiveTurnState()))).toEqual({
      turnId: "turn-1",
      itemId: "u1",
      text: "initial",
    });
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

    expect(threadStreamRollbackCandidate(chatThreadStreamViewState(state, initialChatActiveTurnState()))).toEqual({
      turnId: "turn-1",
      itemId: "u1",
      text: "Use $obsidian-codex-panel-maintain.",
    });
  });

  it("returns null when rollback has no user dialogue candidate", () => {
    expect(
      threadStreamRollbackCandidate(chatThreadStreamViewState(initialChatThreadStreamState([]), initialChatActiveTurnState())),
    ).toBeNull();
  });
});

function dialogueItem(id: string): ThreadStreamItem {
  return { id, kind: "dialogue", role: "assistant", text: id, dialogueKind: "assistantResponse", dialogueState: "completed" };
}

function initialView(items: readonly ThreadStreamItem[] = []) {
  return chatThreadStreamViewState(initialChatThreadStreamState(items), initialChatActiveTurnState());
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
