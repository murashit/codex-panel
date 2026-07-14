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

  it("keeps local context attachment metadata when reconciling by text without client ids", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "https://example.com/ summarize this", "turn"),
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("u1", "https://example.com/ summarize this", "turn");

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next).toEqual([
      expect.objectContaining({
        id: "u1",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      }),
    ]);
  });

  it("falls back to local user text only when server user dialogues have no client ids", () => {
    const currentItems: ThreadStreamItem[] = [
      userDialogue("local-user-without-client-id", "fallback text", "turn"),
      userDialogue("local-user-other-turn", "fallback text", "other"),
    ];
    const turnItems: ThreadStreamItem[] = [userDialogue("u1", "fallback text", "turn")];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-other-turn", "u1"]);
  });

  it("model-checks client-id reconciliation across current and server ordering", () => {
    for (const currentItems of permutations([
      userDialogue("local-user-1", "same text", "turn", "local-user-1"),
      assistantDialogue("local-progress", "progress", "turn"),
      userDialogue("local-user-other", "other turn", "other", "local-user-other"),
    ])) {
      for (const turnItems of permutations([
        userDialogue("server-user", "same text", "turn", "local-user-1"),
        assistantDialogue("server-assistant", "done", "turn"),
      ])) {
        const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });
        const nextIds = next.map((item) => item.id);

        expect(nextIds, reconciliationCase(currentItems, turnItems)).toContain("server-user");
        expect(nextIds, reconciliationCase(currentItems, turnItems)).not.toContain("local-user-1");
        expect(nextIds, reconciliationCase(currentItems, turnItems)).toContain("local-user-other");
        expect(new Set(nextIds).size, reconciliationCase(currentItems, turnItems)).toBe(nextIds.length);
      }
    }
  });

  it("model-checks text fallback reconciliation only for the completed turn", () => {
    for (const currentItems of permutations([
      userDialogue("local-user-completed", "fallback text", "turn"),
      userDialogue("local-user-other-turn", "fallback text", "other"),
      userDialogue("local-user-different-text", "different text", "turn"),
    ])) {
      const next = reconcileCompletedTurnItems({
        currentItems,
        completedTurnId: "turn",
        turnItems: [userDialogue("server-user", "fallback text", "turn")],
      });
      const nextIds = next.map((item) => item.id);

      expect(nextIds, currentIds(currentItems)).toContain("server-user");
      expect(nextIds, currentIds(currentItems)).not.toContain("local-user-completed");
      expect(nextIds, currentIds(currentItems)).toContain("local-user-other-turn");
      expect(nextIds, currentIds(currentItems)).toContain("local-user-different-text");
    }
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]));
}

function reconciliationCase(currentItems: readonly ThreadStreamItem[], turnItems: readonly ThreadStreamItem[]): string {
  return `current=${currentIds(currentItems)} turn=${currentIds(turnItems)}`;
}

function currentIds(items: readonly ThreadStreamItem[]): string {
  return items.map((item) => item.id).join(",");
}

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
