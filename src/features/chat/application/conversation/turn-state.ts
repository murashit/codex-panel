export interface PendingTurnStart {
  readonly anchorItemId: string;
  readonly promptSubmitHookItemIds: readonly string[];
}

export type ChatTurnLifecycleState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly pendingTurnStart: PendingTurnStart }
  | { readonly kind: "running"; readonly turnId: string };

export type ChatTurnLifecycleEvent =
  | { type: "started"; turnId: string }
  | { type: "completed"; turnId: string }
  | { type: "cleared" }
  | { type: "optimistic-started"; pendingTurnStart: PendingTurnStart }
  | { type: "start-acknowledged"; turnId: string }
  | { type: "start-failed" }
  | { type: "pending-start-hook-upserted"; pendingTurnStart: PendingTurnStart | null };

type ChatTurnLifecycleKind = ChatTurnLifecycleState["kind"];
type ChatTurnLifecycleEventType = ChatTurnLifecycleEvent["type"];
type ChatTurnLifecycleTransition = (state: ChatTurnLifecycleState, event: ChatTurnLifecycleEvent) => ChatTurnLifecycleState;
type ChatTurnLifecycleTransitionTable = Record<ChatTurnLifecycleKind, Record<ChatTurnLifecycleEventType, ChatTurnLifecycleTransition>>;

export interface ChatTurnState {
  readonly lifecycle: ChatTurnLifecycleState;
}

export function initialChatTurnState(): ChatTurnState {
  return {
    lifecycle: { kind: "idle" },
  };
}

export function chatTurnBusy(state: { turn: ChatTurnState } | { lifecycle: ChatTurnLifecycleState }): boolean {
  return turnLifecycleFor(state).kind !== "idle";
}

export function activeTurnId(state: { turn: ChatTurnState } | { lifecycle: ChatTurnLifecycleState }): string | null {
  const lifecycle = turnLifecycleFor(state);
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

export function pendingTurnStart(state: { turn: ChatTurnState } | { lifecycle: ChatTurnLifecycleState }): PendingTurnStart | null {
  const lifecycle = turnLifecycleFor(state);
  return lifecycle.kind === "starting" ? lifecycle.pendingTurnStart : null;
}

export function transitionChatTurnLifecycleState(state: ChatTurnLifecycleState, event: ChatTurnLifecycleEvent): ChatTurnLifecycleState {
  return chatTurnLifecycleTransitions[state.kind][event.type](state, event);
}

function turnLifecycleFor(state: { turn: ChatTurnState } | { lifecycle: ChatTurnLifecycleState }): ChatTurnLifecycleState {
  if ("turn" in state) return state.turn.lifecycle;
  return state.lifecycle;
}

const keepLifecycleState: ChatTurnLifecycleTransition = (state) => state;

const clearLifecycleState: ChatTurnLifecycleTransition = (state) => (state.kind === "idle" ? state : { kind: "idle" });

const runningFromStartedEvent: ChatTurnLifecycleTransition = (_state, event) => ({
  kind: "running",
  turnId: requireTurnId(event),
});

const startingFromOptimisticStartEvent: ChatTurnLifecycleTransition = (_state, event) => ({
  kind: "starting",
  pendingTurnStart: requirePendingTurnStart(event),
});

const runningCompletionTransition: ChatTurnLifecycleTransition = (state, event) => {
  if (state.kind !== "running" || state.turnId !== requireTurnId(event)) return state;
  return { kind: "idle" };
};

const startingAcknowledgementTransition: ChatTurnLifecycleTransition = (_state, event) => ({
  kind: "running",
  turnId: requireTurnId(event),
});

const runningAcknowledgementTransition: ChatTurnLifecycleTransition = (state, event) => {
  if (state.kind !== "running" || state.turnId !== requireTurnId(event)) return state;
  return { kind: "running", turnId: state.turnId };
};

const pendingStartHookTransition: ChatTurnLifecycleTransition = (state, event) => {
  const pendingTurnStart = optionalPendingTurnStart(event);
  if (pendingTurnStart) return { kind: "starting", pendingTurnStart };
  return state.kind === "starting" ? { kind: "idle" } : state;
};

const chatTurnLifecycleTransitions: ChatTurnLifecycleTransitionTable = {
  idle: {
    started: runningFromStartedEvent,
    completed: keepLifecycleState,
    cleared: clearLifecycleState,
    "optimistic-started": startingFromOptimisticStartEvent,
    "start-acknowledged": keepLifecycleState,
    "start-failed": keepLifecycleState,
    "pending-start-hook-upserted": pendingStartHookTransition,
  },
  starting: {
    started: runningFromStartedEvent,
    completed: keepLifecycleState,
    cleared: clearLifecycleState,
    "optimistic-started": startingFromOptimisticStartEvent,
    "start-acknowledged": startingAcknowledgementTransition,
    "start-failed": clearLifecycleState,
    "pending-start-hook-upserted": pendingStartHookTransition,
  },
  running: {
    started: runningFromStartedEvent,
    completed: runningCompletionTransition,
    cleared: clearLifecycleState,
    "optimistic-started": startingFromOptimisticStartEvent,
    "start-acknowledged": runningAcknowledgementTransition,
    "start-failed": keepLifecycleState,
    "pending-start-hook-upserted": pendingStartHookTransition,
  },
};

function requireTurnId(event: ChatTurnLifecycleEvent): string {
  if ("turnId" in event) return event.turnId;
  throw new Error(`Turn lifecycle event ${event.type} does not include a turn id.`);
}

function requirePendingTurnStart(event: ChatTurnLifecycleEvent): PendingTurnStart {
  if ("pendingTurnStart" in event && event.pendingTurnStart) return event.pendingTurnStart;
  throw new Error(`Turn lifecycle event ${event.type} does not include pending turn start state.`);
}

function optionalPendingTurnStart(event: ChatTurnLifecycleEvent): PendingTurnStart | null {
  return "pendingTurnStart" in event ? event.pendingTurnStart : null;
}
