import { describe, expect, it } from "vitest";

import {
  type ChatTurnLifecycleEvent,
  type ChatTurnLifecycleState,
  transitionChatTurnLifecycleState,
} from "../../../../../src/features/chat/application/turns/turn-state";

describe("chat turn lifecycle state machine", () => {
  it("moves an optimistic turn through acknowledgement and matching completion", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted("local-user-a"));
    expect(startingState).toEqual(starting("local-user-a"));

    const runningState = transitionChatTurnLifecycleState(startingState, startAcknowledged("turn"));
    expect(runningState).toEqual(running("turn"));

    expect(transitionChatTurnLifecycleState(runningState, completed("turn"))).toEqual(idle());
  });

  it("accepts server start before acknowledgement and completes that turn", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted("local-user-a"));
    const runningState = transitionChatTurnLifecycleState(startingState, started("server-turn"));

    expect(runningState).toEqual(running("server-turn"));
    expect(transitionChatTurnLifecycleState(runningState, completed("server-turn"))).toEqual(idle());
  });

  it("returns a failed optimistic start to idle", () => {
    const startingState = transitionChatTurnLifecycleState(idle(), optimisticStarted("local-user-a"));

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
    ["late start failure", startFailed()],
  ] as const)("keeps the running turn after %s", (_label, event) => {
    expect(transitionChatTurnLifecycleState(running("turn"), event)).toEqual(running("turn"));
  });
});

function idle(): ChatTurnLifecycleState {
  return { kind: "idle" };
}

function starting(anchorItemId: string): ChatTurnLifecycleState {
  return { kind: "starting", anchorItemId };
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

function optimisticStarted(anchorItemId: string): ChatTurnLifecycleEvent {
  return { type: "optimistic-started", anchorItemId };
}

function startAcknowledged(turnId: string): ChatTurnLifecycleEvent {
  return { type: "start-acknowledged", turnId };
}

function startFailed(): ChatTurnLifecycleEvent {
  return { type: "start-failed" };
}
