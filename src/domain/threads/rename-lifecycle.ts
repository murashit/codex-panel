import type { ThreadTitleContext } from "./title-generation-model";

type ThreadRenameAutoNameState = { kind: "checking" } | { kind: "unavailable" } | { kind: "ready"; context: ThreadTitleContext };

export type ThreadRenameLifecycleState =
  | { kind: "idle" }
  | { kind: "editing"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "saving"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "generating"; draft: string; autoName: Extract<ThreadRenameAutoNameState, { kind: "ready" }> };

export type ThreadRenameActiveState = Exclude<ThreadRenameLifecycleState, { kind: "idle" }>;

export type ThreadRenameLifecycleEvent =
  | { type: "started"; draft: string }
  | { type: "draft-updated"; draft: string }
  | { type: "auto-name-context-resolved"; context: ThreadTitleContext | null }
  | { type: "cancelled" }
  | { type: "save-started" }
  | { type: "save-failed" }
  | { type: "save-succeeded" }
  | { type: "generation-started" }
  | { type: "generation-succeeded"; draft: string }
  | { type: "generation-finished" }
  | { type: "cleared" };

export function initialThreadRenameLifecycleState(): ThreadRenameLifecycleState {
  return { kind: "idle" };
}

export function transitionThreadRenameLifecycleState(
  state: ThreadRenameLifecycleState,
  event: ThreadRenameLifecycleEvent,
): ThreadRenameLifecycleState {
  switch (event.type) {
    case "started":
      if (state.kind === "saving") return state;
      return { kind: "editing", draft: event.draft, autoName: { kind: "checking" } };
    case "draft-updated":
      return state.kind === "editing" ? { ...state, draft: event.draft } : state;
    case "auto-name-context-resolved":
      if (state.kind !== "editing" && state.kind !== "saving") return state;
      return {
        ...state,
        autoName: event.context ? { kind: "ready", context: event.context } : { kind: "unavailable" },
      };
    case "cancelled":
      return state.kind === "saving" || state.kind === "idle" ? state : initialThreadRenameLifecycleState();
    case "save-started":
      return state.kind === "editing" ? { ...state, kind: "saving" } : state;
    case "save-failed":
      return state.kind === "saving" ? { kind: "editing", draft: state.draft, autoName: state.autoName } : state;
    case "save-succeeded":
      return state.kind === "saving" ? initialThreadRenameLifecycleState() : state;
    case "generation-started":
      if (state.kind !== "editing" || state.autoName.kind !== "ready") return state;
      return {
        kind: "generating",
        draft: state.draft,
        autoName: state.autoName,
      };
    case "generation-succeeded":
      return state.kind === "generating" ? { ...state, draft: event.draft } : state;
    case "generation-finished":
      return state.kind === "generating" ? { kind: "editing", draft: state.draft, autoName: state.autoName } : state;
    case "cleared":
      return state.kind === "idle" ? state : initialThreadRenameLifecycleState();
    default:
      return unhandledThreadRenameLifecycleEvent(event);
  }
}

function unhandledThreadRenameLifecycleEvent(event: never): never {
  throw new Error(`Unhandled thread rename lifecycle event: ${String(event)}`);
}
