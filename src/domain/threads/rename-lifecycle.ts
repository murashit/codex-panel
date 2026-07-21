import type { ThreadTitleContext } from "./title-generation-model";

type ThreadRenameAutoNameState = { kind: "checking" } | { kind: "unavailable" } | { kind: "ready"; context: ThreadTitleContext };

export type ThreadRenameLifecycleState =
  | { kind: "idle" }
  | { kind: "editing"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "generating"; draft: string; autoName: Extract<ThreadRenameAutoNameState, { kind: "ready" }>; generationToken: number };

export type ThreadRenameActiveState = Exclude<ThreadRenameLifecycleState, { kind: "idle" }>;
type ThreadRenameGeneratingState = Extract<ThreadRenameLifecycleState, { kind: "generating" }>;

export type ThreadRenameLifecycleEvent =
  | { type: "started"; draft: string }
  | { type: "draft-updated"; draft: string }
  | { type: "auto-name-context-resolved"; context: ThreadTitleContext | null }
  | { type: "cancelled" }
  | { type: "generation-started"; generationToken: number }
  | { type: "generation-succeeded"; generationToken: number; draft: string }
  | { type: "generation-finished"; generationToken: number }
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
      return { kind: "editing", draft: event.draft, autoName: { kind: "checking" } };
    case "draft-updated":
      return state.kind === "editing" ? { ...state, draft: event.draft } : state;
    case "auto-name-context-resolved":
      if (state.kind !== "editing") return state;
      return {
        ...state,
        autoName: event.context ? { kind: "ready", context: event.context } : { kind: "unavailable" },
      };
    case "cancelled":
      return state.kind === "idle" ? state : initialThreadRenameLifecycleState();
    case "generation-started":
      if (state.kind !== "editing" || state.autoName.kind !== "ready") return state;
      return {
        kind: "generating",
        draft: state.draft,
        autoName: state.autoName,
        generationToken: event.generationToken,
      };
    case "generation-succeeded":
      if (!threadRenameGenerationStillActive(state, event.generationToken)) return state;
      return { ...state, draft: event.draft };
    case "generation-finished":
      if (!threadRenameGenerationStillActive(state, event.generationToken)) return state;
      return { kind: "editing", draft: state.draft, autoName: state.autoName };
    case "cleared":
      return state.kind === "idle" ? state : initialThreadRenameLifecycleState();
    default:
      return unhandledThreadRenameLifecycleEvent(event);
  }
}

export function threadRenameGenerationStillActive(
  state: ThreadRenameLifecycleState,
  generationToken: number,
): state is ThreadRenameGeneratingState {
  return state.kind === "generating" && state.generationToken === generationToken;
}

function unhandledThreadRenameLifecycleEvent(event: never): never {
  throw new Error(`Unhandled thread rename lifecycle event: ${String(event)}`);
}
