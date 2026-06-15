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
  switch (event.type) {
    case "started":
      return { kind: "running", turnId: event.turnId };
    case "completed":
      return state.kind === "running" && state.turnId === event.turnId ? { kind: "idle" } : state;
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
    case "optimistic-started":
      return { kind: "starting", pendingTurnStart: event.pendingTurnStart };
    case "start-acknowledged":
      if (state.kind === "idle") return state;
      if (state.kind === "running" && state.turnId !== event.turnId) return state;
      return { kind: "running", turnId: event.turnId };
    case "start-failed":
      return state.kind === "starting" ? { kind: "idle" } : state;
    case "pending-start-hook-upserted":
      if (event.pendingTurnStart) return { kind: "starting", pendingTurnStart: event.pendingTurnStart };
      return state.kind === "starting" ? { kind: "idle" } : state;
  }
}

function turnLifecycleFor(state: { turn: ChatTurnState } | { lifecycle: ChatTurnLifecycleState }): ChatTurnLifecycleState {
  if ("turn" in state) return state.turn.lifecycle;
  return state.lifecycle;
}
