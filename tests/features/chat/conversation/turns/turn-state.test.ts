import { describe, expect, it } from "vitest";

import {
  transitionChatTurnLifecycleState,
  type ChatTurnLifecycleEvent,
  type ChatTurnLifecycleState,
  type PendingTurnStart,
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
