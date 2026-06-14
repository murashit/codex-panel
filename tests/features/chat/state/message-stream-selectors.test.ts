import { describe, expect, it } from "vitest";

import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/model/items";
import {
  initialChatMessageStreamState,
  messageStreamRollbackCandidate,
  messageStreamTurnsAfterTurnId,
  messageStreamTurnIds,
  messageStreamWithActiveTurnItems,
} from "../../../../src/features/chat/state/message-stream";

describe("message stream selectors", () => {
  it("counts turns after a turn id from message stream state", () => {
    const state = initialChatMessageStreamState(items());

    expect(messageStreamTurnIds(state)).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(messageStreamTurnsAfterTurnId(state, "turn-1")).toBe(2);
    expect(messageStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
    expect(messageStreamTurnsAfterTurnId(state, "turn-3")).toBe(0);
    expect(messageStreamTurnsAfterTurnId(state, "missing")).toBeNull();
  });

  it("includes the active segment when counting turns", () => {
    const state = messageStreamWithActiveTurnItems(initialChatMessageStreamState(items()), "turn-3", items());

    expect(messageStreamTurnIds(state)).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(messageStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
  });

  it("selects the latest turn user message for rollback restoration", () => {
    const state = initialChatMessageStreamState(items());

    expect(messageStreamRollbackCandidate(state)).toEqual({ turnId: "turn-3", itemId: "u3", text: "third" });
  });

  it("uses the semantic prompt instead of steering messages for rollback restoration", () => {
    const state = initialChatMessageStreamState([
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "initial", turnId: "turn-1" },
      { id: "u2", kind: "message", messageKind: "user", role: "user", text: "steer", turnId: "turn-1", clientId: "local-steer-1" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "turn-1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);

    expect(messageStreamRollbackCandidate(state)).toEqual({ turnId: "turn-1", itemId: "u1", text: "initial" });
  });

  it("restores the raw user message text instead of rendered display text", () => {
    const state = initialChatMessageStreamState([
      {
        id: "u1",
        kind: "message",
        messageKind: "user",
        role: "user",
        text: "Use `$obsidian-codex-panel-maintain`.",
        copyText: "Use $obsidian-codex-panel-maintain.",
        turnId: "turn-1",
      },
    ]);

    expect(messageStreamRollbackCandidate(state)).toEqual({
      turnId: "turn-1",
      itemId: "u1",
      text: "Use $obsidian-codex-panel-maintain.",
    });
  });

  it("returns null when rollback has no user message candidate", () => {
    expect(messageStreamRollbackCandidate(initialChatMessageStreamState([]))).toBeNull();
    expect(
      messageStreamRollbackCandidate(initialChatMessageStreamState([{ id: "system", kind: "system", role: "system", text: "Idle" }])),
    ).toBeNull();
    expect(
      messageStreamRollbackCandidate(
        initialChatMessageStreamState([
          {
            id: "a1",
            kind: "message",
            role: "assistant",
            text: "answer",
            turnId: "turn-1",
            messageKind: "assistantResponse",
            messageState: "completed",
          },
        ]),
      ),
    ).toBeNull();
  });
});

function items(): MessageStreamItem[] {
  return [
    { id: "u1", kind: "message", messageKind: "user", role: "user", text: "first", turnId: "turn-1" },
    {
      id: "a1",
      kind: "message",
      role: "assistant",
      text: "first answer",
      turnId: "turn-1",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
    { id: "tool-1", kind: "tool", role: "tool", text: "work", turnId: "turn-2" },
    {
      id: "a2",
      kind: "message",
      role: "assistant",
      text: "second answer",
      turnId: "turn-2",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
    { id: "u3", kind: "message", messageKind: "user", role: "user", text: "third", turnId: "turn-3" },
    {
      id: "a3",
      kind: "message",
      role: "assistant",
      text: "third answer",
      turnId: "turn-3",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
  ];
}
