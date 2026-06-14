import { describe, expect, it } from "vitest";

import {
  forkCandidatesFromItems,
  isForkCandidateItem,
  isRollbackCandidateItem,
} from "../../../../src/features/chat/domain/message-stream/selectors";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";

describe("message stream item selectors", () => {
  it("selects final assistant messages as fork candidates", () => {
    const streamItems = messageStreamItems();

    const candidates = forkCandidatesFromItems(streamItems);

    expect(candidates).toEqual([
      { itemId: "a1", turnId: "turn-1" },
      { itemId: "a2", turnId: "turn-2" },
      { itemId: "a3", turnId: "turn-3" },
    ]);
    expect(isForkCandidateItem(expectPresent(streamItems[4]), candidates)).toBe(true);
    expect(isForkCandidateItem(expectPresent(streamItems[3]), candidates)).toBe(false);
  });

  it("matches rollback candidate stream items", () => {
    const streamItems = messageStreamItems();
    const candidate = { turnId: "turn-3", itemId: "u3" };

    expect(isRollbackCandidateItem(expectPresent(streamItems[5]), candidate)).toBe(true);
    expect(isRollbackCandidateItem(expectPresent(streamItems[0]), candidate)).toBe(false);
    expect(isRollbackCandidateItem({ ...expectPresent(streamItems[5]), turnId: "turn-other" }, candidate)).toBe(false);
  });
});

function messageStreamItems(): MessageStreamItem[] {
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
