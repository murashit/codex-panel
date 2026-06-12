import { describe, expect, it } from "vitest";

import {
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
  rollbackCandidateFromItems,
  turnsAfterTurnId,
} from "../../../../src/features/chat/display/item-actions";
import type { DisplayItem } from "../../../../src/features/chat/display/types";

describe("fork candidates", () => {
  it("selects final assistant messages and counts later turns", () => {
    const items: DisplayItem[] = [
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
        id: "a2-delta",
        kind: "message",
        role: "assistant",
        text: "draft",
        turnId: "turn-2",
        messageKind: "proposedPlan",
        messageState: "streaming",
      },
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

    const candidates = forkCandidatesFromItems(items);

    expect(candidates).toEqual([
      { displayItemId: "a1", turnId: "turn-1" },
      { displayItemId: "a2", turnId: "turn-2" },
      { displayItemId: "a3", turnId: "turn-3" },
    ]);
    expect(isForkCandidateItem(expectPresent(items[4]), candidates)).toBe(true);
    expect(isForkCandidateItem(expectPresent(items[3]), candidates)).toBe(false);
    expect(turnsAfterTurnId(items, "turn-1")).toBe(2);
    expect(turnsAfterTurnId(items, "turn-2")).toBe(1);
    expect(turnsAfterTurnId(items, "turn-3")).toBe(0);
    expect(turnsAfterTurnId(items, "missing")).toBeNull();
  });
});

describe("rollback candidate", () => {
  it("selects the first user message from the latest turn", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "older", turnId: "turn-1" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "older answer",
        turnId: "turn-1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
      { id: "u2", kind: "message", messageKind: "user", role: "user", text: "latest", turnId: "turn-2" },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "latest answer",
        turnId: "turn-2",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const candidate = rollbackCandidateFromItems(items);

    expect(candidate).toEqual({ turnId: "turn-2", displayItemId: "u2", text: "latest" });
    expect(isRollbackCandidateItem(expectPresent(items[2]), candidate)).toBe(true);
    expect(isRollbackCandidateItem(expectPresent(items[0]), candidate)).toBe(false);
    expect(isRollbackCandidateItem({ ...expectPresent(items[2]), turnId: "turn-other" }, candidate)).toBe(false);
  });

  it("returns null when there is no completed user turn in display items", () => {
    expect(rollbackCandidateFromItems([])).toBeNull();
    expect(rollbackCandidateFromItems([{ id: "system", kind: "system", role: "system", text: "Idle" }])).toBeNull();
    expect(
      rollbackCandidateFromItems([
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
    ).toBeNull();
  });
});

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}
