import { describe, expect, it } from "vitest";

import { reconcileCompletedTurnItems } from "../../../../../src/features/chat/domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("reconcileCompletedTurnItems", () => {
  it("replaces optimistic local user dialogues with server user dialogues that share the client id", () => {
    const currentItems: ThreadStreamItem[] = [
      userDialogue("local-user-1", "same text", "turn", "local-user-1"),
      userDialogue("local-steer-2", "steer", "turn", "local-steer-2"),
      userDialogue("local-user-2", "other turn", "other", "local-user-2"),
    ];
    const turnItems: ThreadStreamItem[] = [
      userDialogue("u1", "same text", "turn", "local-user-1"),
      userDialogue("u2", "steer", "turn", "local-steer-2"),
      assistantDialogue("a1", "done", "turn"),
    ];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-2", "u1", "u2", "a1"]);
  });

  it("keeps local context attachment metadata when replacing an optimistic user dialogue", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "https://example.com/ summarize this", "turn", "local-user-1"),
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("u1", "https://example.com/ summarize this", "turn", "local-user-1");

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next).toEqual([
      expect.objectContaining({
        id: "u1",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      }),
    ]);
  });

  it("keeps local file-reference metadata without sending it through app-server", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "Read [[Note]].", "turn", "local-user-1"),
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("u1", "Read [[Note]].", "turn", "local-user-1");

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next).toEqual([
      expect.objectContaining({
        id: "u1",
        referencedFiles: [{ name: "Note", path: "Note.md" }],
      }),
    ]);
  });

  it("keeps fallback reconciliation scoped to the completed turn", () => {
    const completedTurnOptimistic = {
      ...userDialogue("local-user-completed", "same text", "completed"),
      contextAttachments: [{ label: "Completed context", detail: "completed" }],
    } satisfies ThreadStreamItem;
    const otherTurnOptimistic = {
      ...userDialogue("local-user-other", "same text", "other"),
      contextAttachments: [{ label: "Other context", detail: "other" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("server-user", "same text", "completed");

    const next = reconcileCompletedTurnItems({
      currentItems: [completedTurnOptimistic, otherTurnOptimistic],
      completedTurnId: "completed",
      turnItems: [server],
    });

    expect(next).toEqual([
      otherTurnOptimistic,
      expect.objectContaining({
        id: "server-user",
        contextAttachments: [{ label: "Completed context", detail: "completed" }],
      }),
    ]);
  });

  it("keeps the optimistic reference title while accepting server truncation metadata", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "continue", "turn", "local-user-1"),
      referencedThread: { threadId: "thread-reference", title: "Readable title", includedTurns: 2, turnLimit: 20 },
    } satisfies ThreadStreamItem;
    const server = {
      ...userDialogue("u1", "continue", "turn", "local-user-1"),
      referencedThread: {
        threadId: "thread-reference",
        title: "thread-r",
        includedTurns: 2,
        turnLimit: 20,
        omittedTurns: 3,
        truncated: true,
      },
    } satisfies ThreadStreamItem;

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next[0]).toMatchObject({
      referencedThread: {
        title: "Readable title",
        threadId: "thread-reference",
        omittedTurns: 3,
        truncated: true,
      },
    });
  });

  it("reconciles a stable pending display id through its reserved client id", () => {
    const optimistic = {
      ...userDialogue("local-web-1", "https://example.com/ summarize", "turn", "local-user-1"),
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      provenance: { source: "localUser", channel: "optimistic", interaction: "prompt", sourceId: "local-user-1" },
    } satisfies ThreadStreamItem;
    const server = userDialogue("server-user", optimistic.text, "turn", "local-user-1");

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next).toEqual([
      expect.objectContaining({
        id: "server-user",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      }),
    ]);
  });
});

function userDialogue(id: string, text: string, turnId: string, clientId?: string): Extract<ThreadStreamItem, { dialogueKind: "user" }> {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text,
    copyText: text,
    turnId,
    ...(clientId ? { clientId } : {}),
  };
}

function assistantDialogue(id: string, text: string, turnId: string): ThreadStreamItem {
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
