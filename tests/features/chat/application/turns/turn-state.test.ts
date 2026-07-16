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

  it("model-checks stale callbacks that must not clear a running turn", () => {
    for (const sequence of eventSequences(runningPreservingEvents(), 4)) {
      const finalState = applyTurnEvents(
        running("turn"),
        sequence.map((event) => event.event),
      );

      expect(finalState, sequenceDescription(sequence)).toEqual(running("turn"));
    }
  });

  it("model-checks pending hook ordering before server acknowledgement", () => {
    for (const sequence of eventSequences(pendingHookEvents(), 4)) {
      const finalState = applyTurnEvents(
        idle(),
        sequence.map((event) => event.event),
      );
      const lastPending = lastPendingHookValue(sequence);

      expect(finalState, sequenceDescription(sequence)).toEqual(lastPending ? starting(lastPending) : idle());
    }
  });
});

interface ModeledTurnEvent {
  readonly name: string;
  readonly event: ChatTurnLifecycleEvent;
}

const pendingA = {
  anchorItemId: "local-user-a",
  promptSubmitHookItemIds: ["hook-a"],
} satisfies PendingTurnStart;

const pendingB = {
  anchorItemId: "local-user-b",
  promptSubmitHookItemIds: ["hook-b"],
} satisfies PendingTurnStart;

function runningPreservingEvents(): readonly ModeledTurnEvent[] {
  return [
    modeledTurnEvent("stale completion", completed("stale-turn")),
    modeledTurnEvent("stale acknowledgement", startAcknowledged("stale-turn")),
    modeledTurnEvent("start failure", startFailed()),
    modeledTurnEvent("clear missing pending hook", pendingStartHookUpserted(null)),
  ];
}

function pendingHookEvents(): readonly ModeledTurnEvent[] {
  return [
    modeledTurnEvent("upsert pending A", pendingStartHookUpserted(pendingA)),
    modeledTurnEvent("upsert pending B", pendingStartHookUpserted(pendingB)),
    modeledTurnEvent("clear pending", pendingStartHookUpserted(null)),
  ];
}

function modeledTurnEvent(name: string, event: ChatTurnLifecycleEvent): ModeledTurnEvent {
  return { name, event };
}

function applyTurnEvents(state: ChatTurnLifecycleState, events: readonly ChatTurnLifecycleEvent[]): ChatTurnLifecycleState {
  return events.reduce(transitionChatTurnLifecycleState, state);
}

function eventSequences<T>(events: readonly T[], maxDepth: number): T[][] {
  const sequences: T[][] = [[]];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    for (const prefix of sequences.filter((sequence) => sequence.length === depth - 1)) {
      for (const event of events) {
        sequences.push([...prefix, event]);
      }
    }
  }
  return sequences;
}

function lastPendingHookValue(sequence: readonly ModeledTurnEvent[]): PendingTurnStart | null {
  let pendingTurnStart: PendingTurnStart | null = null;
  for (const { event } of sequence) {
    if (event.type === "pending-start-hook-upserted") pendingTurnStart = event.pendingTurnStart;
  }
  return pendingTurnStart;
}

function sequenceDescription(sequence: readonly ModeledTurnEvent[]): string {
  return sequence.length === 0 ? "no events" : sequence.map((event) => event.name).join(" -> ");
}

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
