import { describe, expect, it } from "vitest";
import { goalChangeItem } from "../../../../../../src/features/chat/domain/thread-stream/factories/goal-items";
import { threadGoalFixture } from "../../../../../support/thread-goal";

describe("goal thread stream items", () => {
  it("keeps goal event summaries compact while retaining the full objective in details", () => {
    const objective = `Ship ${"the feature ".repeat(20)}`.trim();
    const item = goalChangeItem("goal", null, threadGoalFixture({ objective }));

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
