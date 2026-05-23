import { describe, expect, it } from "vitest";

import { isRollbackCandidateItem, rollbackCandidateFromItems } from "../../../src/features/chat/rollback";
import type { DisplayItem } from "../../../src/features/chat/display/types";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("rollback candidate", () => {
  it("selects the first user message from the latest turn", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "older", turnId: "turn-1", markdown: true },
      { id: "a1", kind: "message", role: "assistant", text: "older answer", turnId: "turn-1", markdown: true },
      { id: "u2", kind: "message", role: "user", text: "latest", turnId: "turn-2", markdown: true },
      { id: "a2", kind: "message", role: "assistant", text: "latest answer", turnId: "turn-2", markdown: true },
    ];

    const candidate = rollbackCandidateFromItems(items);

    expect(candidate).toEqual({ turnId: "turn-2", itemId: "u2", text: "latest" });
    expect(isRollbackCandidateItem(expectPresent(items[2]), candidate)).toBe(true);
    expect(isRollbackCandidateItem(expectPresent(items[0]), candidate)).toBe(false);
    expect(isRollbackCandidateItem({ ...expectPresent(items[2]), turnId: "turn-other" }, candidate)).toBe(false);
  });

  it("returns null when there is no completed user turn in display items", () => {
    expect(rollbackCandidateFromItems([])).toBeNull();
    expect(rollbackCandidateFromItems([{ id: "system", kind: "system", role: "system", text: "Idle" }])).toBeNull();
    expect(
      rollbackCandidateFromItems([{ id: "a1", kind: "message", role: "assistant", text: "answer", turnId: "turn-1", markdown: true }]),
    ).toBeNull();
  });
});
