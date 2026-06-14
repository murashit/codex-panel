import { describe, expect, it } from "vitest";

import type { ThreadGoal } from "../../../../src/domain/threads/goal";
import { goalChangeItem } from "../../../../src/features/chat/message-stream/goal-items";

describe("goal message stream items", () => {
  it("keeps goal event summaries compact while retaining the full objective in details", () => {
    const objective = `Ship ${"the feature ".repeat(20)}`.trim();
    const item = goalChangeItem("goal", null, goal({ objective }));

    expect(item).toMatchObject({
      kind: "goal",
      role: "tool",
      action: "set",
      objective,
    });
    expect(item?.text.startsWith("set: Ship the feature")).toBe(true);
    expect(item?.text.length).toBeLessThan(objective.length);
    expect(item?.text.endsWith("...")).toBe(true);
  });
});

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
