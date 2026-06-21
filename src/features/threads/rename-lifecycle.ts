export type ThreadRenameLifecycleState =
  | { kind: "idle" }
  | { kind: "editing"; draft: string }
  | { kind: "generating"; draft: string; originalDraft: string; generationToken: number };

export type ThreadRenameActiveState = Exclude<ThreadRenameLifecycleState, { kind: "idle" }>;
export type ThreadRenameGeneratingState = Extract<ThreadRenameLifecycleState, { kind: "generating" }>;

export type ThreadRenameLifecycleEvent =
  | { type: "started"; draft: string }
  | { type: "draft-updated"; draft: string }
  | { type: "cancelled" }
  | { type: "generation-started"; generationToken: number }
  | { type: "generation-succeeded"; generatingState: ThreadRenameGeneratingState; draft: string }
  | { type: "generation-finished"; generatingState: ThreadRenameGeneratingState }
  | { type: "cleared" };

type ThreadRenameLifecycleKind = ThreadRenameLifecycleState["kind"];
type ThreadRenameLifecycleEventType = ThreadRenameLifecycleEvent["type"];
type ThreadRenameLifecycleTransition = (state: ThreadRenameLifecycleState, event: ThreadRenameLifecycleEvent) => ThreadRenameLifecycleState;
type ThreadRenameLifecycleTransitionTable = Record<
  ThreadRenameLifecycleKind,
  Record<ThreadRenameLifecycleEventType, ThreadRenameLifecycleTransition>
>;

export function initialThreadRenameLifecycleState(): ThreadRenameLifecycleState {
  return { kind: "idle" };
}

export function transitionThreadRenameLifecycleState(
  state: ThreadRenameLifecycleState,
  event: ThreadRenameLifecycleEvent,
): ThreadRenameLifecycleState {
  return threadRenameLifecycleTransitions[state.kind][event.type](state, event);
}

export function threadRenameGenerationStillActive(
  state: ThreadRenameLifecycleState,
  generatingState: ThreadRenameGeneratingState,
): state is ThreadRenameGeneratingState {
  return (
    state.kind === "generating" &&
    state.originalDraft === generatingState.originalDraft &&
    state.generationToken === generatingState.generationToken
  );
}

const keepThreadRenameState: ThreadRenameLifecycleTransition = (state) => state;

const startThreadRenameTransition: ThreadRenameLifecycleTransition = (_state, event) => ({
  kind: "editing",
  draft: requireRenameDraft(event),
});

const updateThreadRenameDraftTransition: ThreadRenameLifecycleTransition = (state, event) => {
  if (state.kind === "idle") return state;
  return { ...state, draft: requireRenameDraft(event) };
};

const cancelThreadRenameTransition: ThreadRenameLifecycleTransition = () => initialThreadRenameLifecycleState();

const startThreadRenameGenerationTransition: ThreadRenameLifecycleTransition = (state, event) => {
  if (state.kind !== "editing") return state;
  return {
    kind: "generating",
    draft: state.draft,
    originalDraft: state.draft,
    generationToken: requireRenameGenerationToken(event),
  };
};

const succeedThreadRenameGenerationTransition: ThreadRenameLifecycleTransition = (state, event) => {
  const generatingState = requireRenameGeneratingState(event);
  if (!threadRenameGenerationStillActive(state, generatingState) || state.draft !== state.originalDraft) return state;
  return { ...state, draft: requireRenameDraft(event) };
};

const finishThreadRenameGenerationTransition: ThreadRenameLifecycleTransition = (state, event) => {
  if (!threadRenameGenerationStillActive(state, requireRenameGeneratingState(event))) return state;
  return { kind: "editing", draft: state.draft };
};

const clearThreadRenameTransition: ThreadRenameLifecycleTransition = (state) =>
  state.kind === "idle" ? state : initialThreadRenameLifecycleState();

const threadRenameActiveTransitions = {
  started: startThreadRenameTransition,
  "draft-updated": updateThreadRenameDraftTransition,
  cancelled: cancelThreadRenameTransition,
  "generation-started": startThreadRenameGenerationTransition,
  "generation-succeeded": succeedThreadRenameGenerationTransition,
  "generation-finished": finishThreadRenameGenerationTransition,
  cleared: clearThreadRenameTransition,
} satisfies Record<ThreadRenameLifecycleEventType, ThreadRenameLifecycleTransition>;

const threadRenameLifecycleTransitions: ThreadRenameLifecycleTransitionTable = {
  idle: {
    ...threadRenameActiveTransitions,
    "draft-updated": keepThreadRenameState,
    cancelled: keepThreadRenameState,
    "generation-started": keepThreadRenameState,
    "generation-succeeded": keepThreadRenameState,
    "generation-finished": keepThreadRenameState,
    cleared: clearThreadRenameTransition,
  },
  editing: threadRenameActiveTransitions,
  generating: {
    ...threadRenameActiveTransitions,
    "generation-started": keepThreadRenameState,
  },
};

function requireRenameDraft(event: ThreadRenameLifecycleEvent): string {
  if ("draft" in event) return event.draft;
  throw new Error(`Thread rename lifecycle event ${event.type} does not include a draft.`);
}

function requireRenameGenerationToken(event: ThreadRenameLifecycleEvent): number {
  if ("generationToken" in event) return event.generationToken;
  throw new Error(`Thread rename lifecycle event ${event.type} does not include a generation token.`);
}

function requireRenameGeneratingState(event: ThreadRenameLifecycleEvent): ThreadRenameGeneratingState {
  if ("generatingState" in event) return event.generatingState;
  throw new Error(`Thread rename lifecycle event ${event.type} does not include generating state.`);
}
