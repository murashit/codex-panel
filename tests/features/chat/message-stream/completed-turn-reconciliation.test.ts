import { describe, expect, it } from "vitest";

import { reconcileCompletedTurnItems } from "../../../../src/features/chat/domain/message-stream/completed-turn-reconciliation";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";

describe("reconcileCompletedTurnItems", () => {
  it("replaces optimistic local user messages with server user messages that share the client id", () => {
    const currentItems: MessageStreamItem[] = [
      userMessage("local-user-1", "same text", "turn", "local-user-1"),
      userMessage("local-steer-2", "steer", "turn", "local-steer-2"),
      userMessage("local-user-2", "other turn", "other", "local-user-2"),
    ];
    const turnItems: MessageStreamItem[] = [
      userMessage("u1", "same text", "turn", "local-user-1"),
      userMessage("u2", "steer", "turn", "local-steer-2"),
      assistantMessage("a1", "done", "turn"),
    ];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-2", "u1", "u2", "a1"]);
  });

  it("falls back to local user text only when server user messages have no client ids", () => {
    const currentItems: MessageStreamItem[] = [
      userMessage("local-user-without-client-id", "fallback text", "turn"),
      userMessage("local-user-other-turn", "fallback text", "other"),
    ];
    const turnItems: MessageStreamItem[] = [userMessage("u1", "fallback text", "turn")];

    const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });

    expect(next.map((item) => item.id)).toEqual(["local-user-other-turn", "u1"]);
  });
});

function userMessage(id: string, text: string, turnId: string, clientId?: string): MessageStreamItem {
  return {
    id,
    kind: "message",
    messageKind: "user",
    role: "user",
    text,
    copyText: text,
    turnId,
    ...(clientId ? { clientId } : {}),
  };
}

function assistantMessage(id: string, text: string, turnId: string): MessageStreamItem {
  return {
    id,
    kind: "message",
    messageKind: "assistantResponse",
    role: "assistant",
    text,
    messageState: "completed",
    turnId,
  };
}
