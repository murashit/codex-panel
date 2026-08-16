import { describe, expect, it } from "vitest";
import { planTurnSubmission } from "../../../../../src/features/chat/application/submission/turn-submission-plan";

describe("turn submission planning", () => {
  it("starts a thread when the panel has no active thread", () => {
    expect(planTurnSubmission({ busy: false, activeThreadId: null, activeTurnId: null })).toEqual({
      kind: "start-thread-then-turn",
    });
  });

  it("starts a turn in the active idle thread", () => {
    expect(planTurnSubmission({ busy: false, activeThreadId: "thread", activeTurnId: null })).toEqual({
      kind: "start-turn",
      threadId: "thread",
    });
  });

  it("steers only when the busy target has an active turn", () => {
    expect(planTurnSubmission({ busy: true, activeThreadId: "thread", activeTurnId: "turn" })).toEqual({
      kind: "steer",
      threadId: "thread",
      turnId: "turn",
    });
    expect(planTurnSubmission({ busy: true, activeThreadId: "thread", activeTurnId: null })).toEqual({
      kind: "blocked",
      message: "Current turn is not steerable yet.",
    });
  });
});
