import { describe, expect, it } from "vitest";

import {
  completedTurnTitleContext,
  firstThreadTitleContextFromThreadStreamItems,
  threadTitleContextFromThreadStreamItems,
} from "../../../../../src/features/chat/application/threads/title-context";

describe("chat thread title context", () => {
  it("prefers displayed completed-turn context to the notification summary", () => {
    expect(
      completedTurnTitleContext(
        "turn",
        [
          { id: "user", kind: "dialogue", dialogueKind: "user", role: "user", text: "Visible request", turnId: "turn" },
          {
            id: "assistant",
            kind: "dialogue",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
            role: "assistant",
            text: "Visible answer",
            turnId: "turn",
          },
        ],
        { userText: "Summary request", assistantText: "Summary answer" },
      ),
    ).toEqual({ userRequest: "Visible request", assistantResponse: "Visible answer" });
  });

  it("uses the completed summary when the visible turn is incomplete", () => {
    expect(completedTurnTitleContext("turn", [], { userText: "Summary request", assistantText: "Summary answer" })).toEqual({
      userRequest: "Summary request",
      assistantResponse: "Summary answer",
    });
    expect(completedTurnTitleContext("turn", [], null)).toBeNull();
    expect(completedTurnTitleContext("turn", [], { userText: "Request", assistantText: null })).toBeNull();
  });

  it("uses the first usable displayed turn as a resumed-history fallback", () => {
    expect(
      firstThreadTitleContextFromThreadStreamItems([
        { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "Request-only turn", turnId: "turn-1" },
        { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "Name this thread from its history", turnId: "turn-2" },
        {
          id: "a2",
          kind: "dialogue",
          role: "assistant",
          text: "Generate a title from the displayed history.",
          turnId: "turn-2",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
        { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "Later turn", turnId: "turn-3" },
        {
          id: "a3",
          kind: "dialogue",
          role: "assistant",
          text: "Later response",
          turnId: "turn-3",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "Name this thread from its history",
      assistantResponse: "Generate a title from the displayed history.",
    });
  });

  it("uses a preceding goal event objective when the first completed turn has no user item", () => {
    expect(
      threadTitleContextFromThreadStreamItems("turn", [
        {
          id: "goal",
          kind: "goal",
          role: "tool",
          text: "Goal set.",
          action: "set",
          objective: "Name this goal-started thread",
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "Implemented the goal.",
          turnId: "turn",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "Name this goal-started thread",
      assistantResponse: "Implemented the goal.",
    });
  });
});
