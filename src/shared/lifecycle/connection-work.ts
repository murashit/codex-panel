export type ConnectionWorkLifecycleState = { kind: "idle" } | { kind: "connecting"; promise: Promise<void> | null };
export type ActiveConnectionWork = Extract<ConnectionWorkLifecycleState, { kind: "connecting" }>;
export type ConnectionWorkLifecycleEvent =
  | { type: "started"; connection: ActiveConnectionWork }
  | { type: "finished"; connection: ActiveConnectionWork; promise: Promise<void> }
  | { type: "invalidated" };

export function transitionConnectionWorkLifecycle(
  state: ConnectionWorkLifecycleState,
  event: ConnectionWorkLifecycleEvent,
): ConnectionWorkLifecycleState {
  switch (event.type) {
    case "started":
      return event.connection;
    case "finished":
      return state === event.connection && state.promise === event.promise ? { kind: "idle" } : state;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
