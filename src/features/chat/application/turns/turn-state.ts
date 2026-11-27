export const STATUS_TURN_RUNNING = "Turn running...";

export type ChatTurnLifecycleState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly anchorItemId: string }
  | { readonly kind: "running"; readonly turnId: string };

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
