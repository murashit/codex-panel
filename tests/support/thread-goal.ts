import type { ThreadGoal } from "../../src/domain/threads/goal";

export function threadGoalFixture(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    ...overrides,
  };
}
