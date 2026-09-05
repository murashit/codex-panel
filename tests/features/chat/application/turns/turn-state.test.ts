import { describe, expect, it } from "vitest";

import {
  type ChatTurnLifecycleEvent,
  type ChatTurnLifecycleState,
  type PendingTurnStart,
  transitionChatTurnLifecycleState,
} from "../../../../../src/features/chat/application/turns/turn-state";

describe("chat turn lifecycle state machine", () => {
  it("moves an optimistic turn through acknowledgement and matching completion", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted(pendingA));
    expect(startingState).toEqual(starting(pendingA));

    const runningState = transitionChatTurnLifecycleState(startingState, startAcknowledged("turn"));
    expect(runningState).toEqual(running("turn"));

    expect(transitionChatTurnLifecycleState(runningState, completed("turn"))).toEqual(idle());
  });

  it("accepts server start before acknowledgement and completes that turn", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted(pendingA));
    const runningState = transitionChatTurnLifecycleState(startingState, started("server-turn"));

    expect(runningState).toEqual(running("server-turn"));
    expect(transitionChatTurnLifecycleState(runningState, completed("server-turn"))).toEqual(idle());
  });

  it("returns a failed optimistic start to idle", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted(pendingA));

    expect(transitionChatTurnLifecycleState(startingState, startFailed())).toEqual(idle());
  });

  it("distinguishes stale and accepted acknowledgements for reducer publication", () => {
    const current = running("turn");

    expect(transitionChatTurnLifecycleState(current, startAcknowledged("stale-turn"))).toBe(current);

    const accepted = transitionChatTurnLifecycleState(current, startAcknowledged("turn"));
    expect(accepted).not.toBe(current);
    expect(accepted).toEqual(current);
  });

  it.each([
    ["stale completion", completed("stale-turn")],
    ["stale acknowledgement", startAcknowledged("stale-turn")],
    ["late start failure", startFailed()],
    ["cleared pending hook", pendingStartHookUpserted(null)],
  ] as const)("keeps the running turn after %s", (_label, event) => {
    expect(transitionChatTurnLifecycleState(running("turn"), event)).toEqual(running("turn"));
  });

  it("updates pending hooks and clears an abandoned optimistic start", () => {
    const initial = transitionChatTurnLifecycleState(idle(), optimisticStarted(pendingA));
    const updated = transitionChatTurnLifecycleState(initial, pendingStartHookUpserted(pendingB));

    expect(updated).toEqual(starting(pendingB));
    expect(transitionChatTurnLifecycleState(updated, pendingStartHookUpserted(null))).toEqual(idle());
  });
});

const pendingA = {
  anchorItemId: "local-user-a",
  promptSubmitHookItemIds: ["hook-a"],
} satisfies PendingTurnStart;

const pendingB = {
  anchorItemId: "local-user-b",
  promptSubmitHookItemIds: ["hook-b"],
} satisfies PendingTurnStart;

function idle(): ChatTurnLifecycleState {
  return { kind: "idle" };
}

function starting(pendingTurnStart: PendingTurnStart): ChatTurnLifecycleState {
  return { kind: "starting", pendingTurnStart };
}

function running(turnId: string): ChatTurnLifecycleState {
  return { kind: "running", turnId };
}

function started(turnId: string): ChatTurnLifecycleEvent {
  return { type: "started", turnId };
}

function completed(turnId: string): ChatTurnLifecycleEvent {
  return { type: "completed", turnId };
}

function optimisticStarted(pendingTurnStart: PendingTurnStart): ChatTurnLifecycleEvent {
  return { type: "optimistic-started", pendingTurnStart };
}

function startAcknowledged(turnId: string): ChatTurnLifecycleEvent {
  return { type: "start-acknowledged", turnId };
}

function startFailed(): ChatTurnLifecycleEvent {
  return { type: "start-failed" };
}

function pendingStartHookUpserted(pendingTurnStart: PendingTurnStart | null): ChatTurnLifecycleEvent {
  return { type: "pending-start-hook-upserted", pendingTurnStart };
}
