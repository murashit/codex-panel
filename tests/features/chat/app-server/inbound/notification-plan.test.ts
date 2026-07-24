import { describe, expect, it } from "vitest";

import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { planChatInboundNotification } from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import { chatStateFixture } from "../../support/state";

describe("chat notification plan", () => {
  it("owns active-thread goal projection and ignores other-thread goals", () => {
    const currentGoal = {
      threadId: "thread-active",
      objective: "Current",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];
    const nextGoal = { ...currentGoal, objective: "Next", updatedAt: 2 };
    const state = chatStateFixture({ activeThread: { id: "thread-active", goal: currentGoal } });

    expect(
      planChatInboundNotification(
        state,
        { method: "thread/goal/updated", params: { threadId: "thread-other", turnId: null, goal: nextGoal } },
        (prefix) => `${prefix}-1`,
      ),
    ).toEqual({ actions: [], effects: [] });
    expect(
      planChatInboundNotification(
        state,
        { method: "thread/goal/updated", params: { threadId: "thread-active", turnId: null, goal: nextGoal } },
        (prefix) => `${prefix}-1`,
      ).actions,
    ).toEqual([
      { type: "active-thread/goal-set", goal: nextGoal },
      { type: "thread-stream/item-upserted", item: expect.objectContaining({ id: "goal-1", kind: "goal", objective: "Next" }) },
    ]);
  });
});
