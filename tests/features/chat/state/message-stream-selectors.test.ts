import { describe, expect, it } from "vitest";

import type { DisplayItem } from "../../../../src/features/chat/display/types";
import {
  initialChatMessageStreamState,
  messageStreamRollbackCandidate,
  messageStreamTurnsAfterTurnId,
  messageStreamTurnIds,
  messageStreamWithActiveTurnItems,
} from "../../../../src/features/chat/state/message-stream";

describe("message stream selectors", () => {
  it("counts turns after a turn id from message stream state", () => {
    const state = initialChatMessageStreamState(displayItems());

    expect(messageStreamTurnIds(state)).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(messageStreamTurnsAfterTurnId(state, "turn-1")).toBe(2);
    expect(messageStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
    expect(messageStreamTurnsAfterTurnId(state, "turn-3")).toBe(0);
    expect(messageStreamTurnsAfterTurnId(state, "missing")).toBeNull();
  });

  it("includes the active segment when counting turns", () => {
    const state = messageStreamWithActiveTurnItems(initialChatMessageStreamState(displayItems()), "turn-3", displayItems());

    expect(messageStreamTurnIds(state)).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(messageStreamTurnsAfterTurnId(state, "turn-2")).toBe(1);
  });

  it("selects the latest turn user message for rollback restoration", () => {
    const state = initialChatMessageStreamState(displayItems());

    expect(messageStreamRollbackCandidate(state)).toEqual({ turnId: "turn-3", displayItemId: "u3", text: "third" });
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

function displayItems(): DisplayItem[] {
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
