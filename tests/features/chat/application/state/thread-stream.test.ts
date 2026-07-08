import { describe, expect, it } from "vitest";
import {
  initialChatThreadStreamState,
  threadStreamRollbackCandidate,
  threadStreamTurnsAfterTurnId,
  threadStreamWithActiveTurnItems,
} from "../../../../../src/features/chat/application/state/thread-stream";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

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

  it("selects the latest turn user message for rollback restoration", () => {
    const state = initialChatThreadStreamState(items());

    expect(threadStreamRollbackCandidate(state)).toEqual({ turnId: "turn-3", itemId: "u3", text: "third" });
  });

  it("uses the semantic prompt instead of steering messages for rollback restoration", () => {
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

  it("restores the raw user message text instead of rendered display text", () => {
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

  it("returns null when rollback has no user message candidate", () => {
    expect(threadStreamRollbackCandidate(initialChatThreadStreamState([]))).toBeNull();
    expect(
      threadStreamRollbackCandidate(initialChatThreadStreamState([{ id: "system", kind: "system", role: "system", text: "Idle" }])),
    ).toBeNull();
    expect(
      threadStreamRollbackCandidate(
        initialChatThreadStreamState([
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "answer",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ]),
      ),
    ).toBeNull();
  });
});

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
    {
      id: "a3",
      kind: "dialogue",
      role: "assistant",
      text: "third answer",
      turnId: "turn-3",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}
