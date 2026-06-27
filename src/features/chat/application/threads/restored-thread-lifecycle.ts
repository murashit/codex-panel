export interface RestoredThreadState {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export type RestoredThreadLifecycleState =
  | { kind: "idle" }
  | { kind: "placeholder"; threadId: string; title: string | null; explicitName: string | null; loading: Promise<void> | null };
export type RestoredThreadPlaceholderState = Extract<RestoredThreadLifecycleState, { kind: "placeholder" }>;
export type RestoredThreadLifecycleEvent =
  | { type: "placeholder-restored"; restoredThread: RestoredThreadState }
  | { type: "renamed"; threadId: string; name: string | null }
  | { type: "loading-started"; loading: Promise<void> }
  | { type: "loading-finished"; loading: Promise<void> }
  | { type: "cleared" };

export function transitionRestoredThreadLifecycle(
  state: RestoredThreadLifecycleState,
  event: RestoredThreadLifecycleEvent,
): RestoredThreadLifecycleState {
  switch (event.type) {
    case "placeholder-restored":
      return { kind: "placeholder", ...event.restoredThread, loading: null };
    case "renamed":
      if (state.kind !== "placeholder" || state.threadId !== event.threadId) return state;
      return { ...state, title: event.name, explicitName: event.name };
    case "loading-started":
      if (state.kind !== "placeholder") return state;
      return { ...state, loading: event.loading };
    case "loading-finished":
      if (state.kind !== "placeholder" || state.loading !== event.loading) return state;
      return { ...state, loading: null };
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
