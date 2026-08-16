import { describe, expect, it } from "vitest";
import {
  initialChatThreadStreamState,
  threadStreamStartActiveSegment,
} from "../../../../../src/features/chat/application/state/thread-stream";
import { initialChatActiveTurnState } from "../../../../../src/features/chat/application/state/turn-scope";
import {
  captureForkDisplaySnapshot,
  reconcileForkDisplayItems,
} from "../../../../../src/features/chat/application/threads/fork-display-snapshot";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("fork display snapshots", () => {
  it.each([
    { position: { kind: "through-turn", turnId: "turn-1" } as const },
    { position: { kind: "before-turn", turnId: "turn-2" } as const },
  ])("captures only scoped display state at $position.kind", ({ position }) => {
    const stable = initialChatThreadStreamState([
      message("u1", "turn-1"),
      unscopedSystemMessage(),
      taskProgress("turn-1"),
      message("u2", "turn-2"),
    ]);
    const state = threadStreamStartActiveSegment(
      {
        ...stable,
        ...initialChatActiveTurnState(),
        turnDiffs: new Map([
          ["turn-1", "diff one"],
          ["turn-2", "diff two"],
        ]),
      },
      "turn-active",
      [message("active", "turn-active")],
    );

    const snapshot = captureForkDisplaySnapshot(state, position);

    expect(snapshot.items.map((item) => item.id)).toEqual(["u1", "plan-progress-turn-1"]);
    expect([...snapshot.turnDiffs]).toEqual([["turn-1", "diff one"]]);
  });

  it("keeps display-only items while preferring hydrated app-server items", () => {
    const displayItems = [message("u1", "turn-1", "local"), taskProgress("turn-1"), message("u2", "turn-2", "local")];
    const historyItems = [message("u1", "turn-1", "server"), message("a1", "turn-1", "answer"), message("u2", "turn-2", "server")];

    const reconciled = reconcileForkDisplayItems(displayItems, historyItems);

    expect(reconciled.map((item) => item.id)).toEqual(["u1", "plan-progress-turn-1", "a1", "u2"]);
    expect(reconciled.find((item) => item.id === "u1")).toMatchObject({ text: "server" });
  });

  it("retains Panel-owned user context metadata while accepting hydrated user history", () => {
    const displayUser = {
      id: "local-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Read [[Note]]",
      copyText: "Read [[Note]]",
      turnId: "turn",
      clientId: "submission",
      contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
      referencedFiles: [{ name: "Note", path: "Note.md" }],
      referencedThread: { threadId: "source-thread", title: "Source thread", includedTurns: 3, turnLimit: 20 },
      provenance: { source: "localUser", channel: "optimistic", interaction: "prompt", sourceId: "submission" },
    } satisfies ThreadStreamItem;
    const historyUser = {
      id: "server-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Read [[Note]]",
      copyText: "Read [[Note]]",
      turnId: "turn",
      clientId: "submission",
    } satisfies ThreadStreamItem;

    const reconciled = reconcileForkDisplayItems([displayUser], [historyUser]);

    expect(reconciled).toEqual([
      expect.objectContaining({
        id: "server-user",
        contextAttachments: displayUser.contextAttachments,
        referencedFiles: displayUser.referencedFiles,
        referencedThread: displayUser.referencedThread,
      }),
    ]);
  });

  it("keeps the complete display payload for an already-hydrated user item", () => {
    const displayUser = {
      id: "server-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Displayed prompt",
      copyText: "Copyable prompt",
      turnId: "turn",
      contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
      referencedFiles: [{ name: "Note", path: "Note.md" }],
      referencedThread: { threadId: "source-thread", title: "Source thread", includedTurns: 3, turnLimit: 20 },
    } satisfies ThreadStreamItem;
    const historyUser = {
      id: "server-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Canonical prompt",
      turnId: "turn",
    } satisfies ThreadStreamItem;

    expect(reconcileForkDisplayItems([displayUser], [historyUser])).toEqual([
      {
        ...displayUser,
        text: "Canonical prompt",
      },
    ]);
  });
});

function message(id: string, turnId: string, text = id): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text,
    dialogueState: "completed",
    turnId,
  };
}

function taskProgress(turnId: string): ThreadStreamItem {
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    explanation: null,
    steps: [{ step: "Keep this", status: "completed" }],
    status: "completed",
    executionState: "completed",
  };
}

function unscopedSystemMessage(): ThreadStreamItem {
  return { id: "system", kind: "system", role: "system", text: "Do not inherit" };
}
