import { describe, expect, it } from "vitest";

import {
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
} from "../../../../src/features/chat/display/item-selectors";
import type { DisplayItem } from "../../../../src/features/chat/display/types";

describe("display item selectors", () => {
  it("selects final assistant messages as fork candidates", () => {
    const items = displayItems();

    const candidates = forkCandidatesFromItems(items);

    expect(candidates).toEqual([
      { displayItemId: "a1", turnId: "turn-1" },
      { displayItemId: "a2", turnId: "turn-2" },
      { displayItemId: "a3", turnId: "turn-3" },
    ]);
    expect(isForkCandidateItem(expectPresent(items[4]), candidates)).toBe(true);
    expect(isForkCandidateItem(expectPresent(items[3]), candidates)).toBe(false);
  });

  it("matches rollback candidate display items", () => {
    const items = displayItems();
    const candidate = { turnId: "turn-3", displayItemId: "u3" };

    expect(isRollbackCandidateItem(expectPresent(items[5]), candidate)).toBe(true);
    expect(isRollbackCandidateItem(expectPresent(items[0]), candidate)).toBe(false);
    expect(isRollbackCandidateItem({ ...expectPresent(items[5]), turnId: "turn-other" }, candidate)).toBe(false);
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
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}
