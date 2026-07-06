import { describe, expect, it } from "vitest";

import {
  type ChatTurnLifecycleEvent,
  type ChatTurnLifecycleState,
  type PendingTurnStart,
  transitionChatTurnLifecycleState,
} from "../../../../../src/features/chat/application/conversation/turn-state";

describe("chat turn lifecycle state machine", () => {
  it.each([
    {
      name: "idle starts from server notification",
      state: idle(),
      event: started("turn"),
      expected: running("turn"),
    },
    {
      name: "starting starts from server notification",
      state: starting(pendingA),
      event: started("turn"),
      expected: running("turn"),
    },
    {
      name: "running starts from newer server notification",
      state: running("previous-turn"),
      event: started("turn"),
      expected: running("turn"),
    },
    {
      name: "idle ignores completion",
      state: idle(),
      event: completed("turn"),
      expected: idle(),
    },
    {
      name: "starting ignores stale completion",
      state: starting(pendingA),
      event: completed("turn"),
      expected: starting(pendingA),
    },
    {
      name: "running completes matching turn",
      state: running("turn"),
      event: completed("turn"),
      expected: idle(),
    },
    {
      name: "running ignores stale completion",
      state: running("turn"),
      event: completed("stale-turn"),
      expected: running("turn"),
    },
    {
      name: "idle stays idle when cleared",
      state: idle(),
      event: cleared(),
      expected: idle(),
    },
    {
      name: "starting clears",
      state: starting(pendingA),
      event: cleared(),
      expected: idle(),
    },
    {
      name: "running clears",
      state: running("turn"),
      event: cleared(),
      expected: idle(),
    },
    {
      name: "idle records optimistic start",
      state: idle(),
      event: optimisticStarted(pendingA),
      expected: starting(pendingA),
    },
    {
      name: "starting replaces optimistic start",
      state: starting(pendingA),
      event: optimisticStarted(pendingB),
      expected: starting(pendingB),
    },
    {
      name: "running can be replaced by optimistic start",
      state: running("turn"),
      event: optimisticStarted(pendingA),
      expected: starting(pendingA),
    },
    {
      name: "idle ignores start acknowledgement",
      state: idle(),
      event: startAcknowledged("turn"),
      expected: idle(),
    },
    {
      name: "starting acknowledges turn start",
      state: starting(pendingA),
      event: startAcknowledged("turn"),
      expected: running("turn"),
    },
    {
      name: "running accepts matching acknowledgement",
      state: running("turn"),
      event: startAcknowledged("turn"),
      expected: running("turn"),
    },
    {
      name: "running ignores stale acknowledgement",
      state: running("turn"),
      event: startAcknowledged("stale-turn"),
      expected: running("turn"),
    },
    {
      name: "idle ignores start failure",
      state: idle(),
      event: startFailed(),
      expected: idle(),
    },
    {
      name: "starting clears after start failure",
      state: starting(pendingA),
      event: startFailed(),
      expected: idle(),
    },
    {
      name: "running ignores stale start failure",
      state: running("turn"),
      event: startFailed(),
      expected: running("turn"),
    },
    {
      name: "idle records pending hook state",
      state: idle(),
      event: pendingStartHookUpserted(pendingA),
      expected: starting(pendingA),
    },
    {
      name: "idle ignores cleared pending hook state",
      state: idle(),
      event: pendingStartHookUpserted(null),
      expected: idle(),
    },
    {
      name: "starting replaces pending hook state",
      state: starting(pendingA),
      event: pendingStartHookUpserted(pendingB),
      expected: starting(pendingB),
    },
    {
      name: "starting clears when pending hook state clears",
      state: starting(pendingA),
      event: pendingStartHookUpserted(null),
      expected: idle(),
    },
    {
      name: "running records pending hook state",
      state: running("turn"),
      event: pendingStartHookUpserted(pendingA),
      expected: starting(pendingA),
    },
    {
      name: "running ignores cleared pending hook state",
      state: running("turn"),
      event: pendingStartHookUpserted(null),
      expected: running("turn"),
    },
  ])("$name", ({ state, event, expected }) => {
    expect(transitionChatTurnLifecycleState(state, event)).toEqual(expected);
  });

  it.each([
    {
      name: "idle completion",
      state: idle(),
      event: completed("turn"),
    },
    {
      name: "idle clear",
      state: idle(),
      event: cleared(),
    },
    {
      name: "idle acknowledgement",
      state: idle(),
      event: startAcknowledged("turn"),
    },
    {
      name: "idle start failure",
      state: idle(),
      event: startFailed(),
    },
    {
      name: "idle cleared pending hook state",
      state: idle(),
      event: pendingStartHookUpserted(null),
    },
    {
      name: "starting completion",
      state: starting(pendingA),
      event: completed("turn"),
    },
    {
      name: "running stale completion",
      state: running("turn"),
      event: completed("stale-turn"),
    },
    {
      name: "running stale acknowledgement",
      state: running("turn"),
      event: startAcknowledged("stale-turn"),
    },
    {
      name: "running start failure",
      state: running("turn"),
      event: startFailed(),
    },
    {
      name: "running cleared pending hook state",
      state: running("turn"),
      event: pendingStartHookUpserted(null),
    },
  ])("preserves state identity for ignored transition: $name", ({ state, event }) => {
    expect(transitionChatTurnLifecycleState(state, event)).toBe(state);
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

function cleared(): ChatTurnLifecycleEvent {
  return { type: "cleared" };
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
