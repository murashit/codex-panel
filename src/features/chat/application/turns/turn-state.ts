export const STATUS_TURN_RUNNING = "Turn running...";

export type ChatTurnLifecycleState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly anchorItemId: string }
  | { readonly kind: "running"; readonly turnId: string };

export type ChatTurnLifecycleEvent =
  | { type: "started"; turnId: string }
  | { type: "completed"; turnId: string }
  | { type: "cleared" }
  | { type: "optimistic-started"; anchorItemId: string }
  | { type: "start-acknowledged"; turnId: string }
  | { type: "start-failed" };

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

export function transitionChatTurnLifecycleState(state: ChatTurnLifecycleState, event: ChatTurnLifecycleEvent): ChatTurnLifecycleState {
  switch (event.type) {
    case "started":
      return { kind: "running", turnId: event.turnId };
    case "completed":
      return state.kind === "running" && state.turnId === event.turnId ? { kind: "idle" } : state;
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
    case "optimistic-started":
      return { kind: "starting", anchorItemId: event.anchorItemId };
    case "start-acknowledged":
      if (state.kind === "starting" || (state.kind === "running" && state.turnId === event.turnId)) {
        return { kind: "running", turnId: event.turnId };
      }
      return state;
    case "start-failed":
      return state.kind === "starting" ? { kind: "idle" } : state;
    default:
      return unhandledChatTurnLifecycleEvent(event);
  }
}

function unhandledChatTurnLifecycleEvent(event: never): never {
  throw new Error(`Unhandled chat turn lifecycle event: ${String(event)}`);
}
