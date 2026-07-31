export interface PendingTurnStart {
  readonly anchorItemId: string;
  readonly promptSubmitHookItemIds: readonly string[];
}

export const STATUS_TURN_RUNNING = "Turn running...";

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

export interface ChatTurnLifecycleOwner {
  readonly lifecycle: ChatTurnLifecycleState;
}

export function chatTurnBusy(state: ChatTurnLifecycleOwner): boolean {
  return state.lifecycle.kind !== "idle";
}

export function activeTurnId(state: ChatTurnLifecycleOwner): string | null {
  const lifecycle = state.lifecycle;
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

export function pendingTurnStart(state: ChatTurnLifecycleOwner): PendingTurnStart | null {
  const lifecycle = state.lifecycle;
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
      if (state.kind === "starting" || (state.kind === "running" && state.turnId === event.turnId)) {
        return { kind: "running", turnId: event.turnId };
      }
      return state;
    case "start-failed":
      return state.kind === "starting" ? { kind: "idle" } : state;
    case "pending-start-hook-upserted":
      if (event.pendingTurnStart) return { kind: "starting", pendingTurnStart: event.pendingTurnStart };
      return state.kind === "starting" ? { kind: "idle" } : state;
    default:
      return unhandledChatTurnLifecycleEvent(event);
  }
}

function unhandledChatTurnLifecycleEvent(event: never): never {
  throw new Error(`Unhandled chat turn lifecycle event: ${String(event)}`);
}
