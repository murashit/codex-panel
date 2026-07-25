import { describe, expect, it } from "vitest";

import {
  appServerThreadGoalUpdate,
  appServerThreadGoalUserHistoryItem,
  threadGoalFromAppServerGoal,
} from "../../../src/app-server/protocol/thread-goal";

describe("app-server thread goal model", () => {
  it("maps app-server goals into panel-owned goal snapshots", () => {
    expect(
      threadGoalFromAppServerGoal({
        threadId: "thread",
        objective: "Finish",
        status: "active",
        tokenBudget: 100,
        tokensUsed: Number.POSITIVE_INFINITY,
        timeUsedSeconds: 12,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toEqual({
      threadId: "thread",
      objective: "Finish",
      status: "active",
      tokenBudget: 100,
      tokensUsed: 0,
      timeUsedSeconds: 12,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("serializes partial goal updates without inventing omitted fields", () => {
    expect(appServerThreadGoalUpdate({ status: "paused" })).toEqual({ status: "paused" });
    expect(appServerThreadGoalUpdate({ objective: "Updated", tokenBudget: null })).toEqual({
      objective: "Updated",
      tokenBudget: null,
    });
  });

  it("builds the app-server history item for goal creation messages", () => {
    expect(appServerThreadGoalUserHistoryItem("Finish this")).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Finish this" }],
    });
  });
});
