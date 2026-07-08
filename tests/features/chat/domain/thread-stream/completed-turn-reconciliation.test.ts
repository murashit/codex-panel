import { describe, expect, it } from "vitest";

import { reconcileCompletedTurnItems } from "../../../../../src/features/chat/domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("reconcileCompletedTurnItems", () => {
  it("replaces optimistic local user messages with server user messages that share the client id", () => {
    const currentItems: ThreadStreamItem[] = [
      userMessage("local-user-1", "same text", "turn", "local-user-1"),
      userMessage("local-steer-2", "steer", "turn", "local-steer-2"),
      userMessage("local-user-2", "other turn", "other", "local-user-2"),
    ];
    const turnItems: ThreadStreamItem[] = [
      userMessage("u1", "same text", "turn", "local-user-1"),
      userMessage("u2", "steer", "turn", "local-steer-2"),
      assistantMessage("a1", "done", "turn"),
    ];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-2", "u1", "u2", "a1"]);
  });

  it("falls back to local user text only when server user messages have no client ids", () => {
    const currentItems: ThreadStreamItem[] = [
      userMessage("local-user-without-client-id", "fallback text", "turn"),
      userMessage("local-user-other-turn", "fallback text", "other"),
    ];
    const turnItems: ThreadStreamItem[] = [userMessage("u1", "fallback text", "turn")];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-other-turn", "u1"]);
  });

  it("model-checks client-id reconciliation across current and server ordering", () => {
    for (const currentItems of permutations([
      userMessage("local-user-1", "same text", "turn", "local-user-1"),
      assistantMessage("local-progress", "progress", "turn"),
      userMessage("local-user-other", "other turn", "other", "local-user-other"),
    ])) {
      for (const turnItems of permutations([
        userMessage("server-user", "same text", "turn", "local-user-1"),
        assistantMessage("server-assistant", "done", "turn"),
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
      userMessage("local-user-completed", "fallback text", "turn"),
      userMessage("local-user-other-turn", "fallback text", "other"),
      userMessage("local-user-different-text", "different text", "turn"),
    ])) {
      const next = reconcileCompletedTurnItems({
        currentItems,
        completedTurnId: "turn",
        turnItems: [userMessage("server-user", "fallback text", "turn")],
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

function userMessage(id: string, text: string, turnId: string, clientId?: string): ThreadStreamItem {
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

function assistantMessage(id: string, text: string, turnId: string): ThreadStreamItem {
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
