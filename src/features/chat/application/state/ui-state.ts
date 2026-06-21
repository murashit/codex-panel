import type { ThreadGoal } from "../../../../domain/threads/goal";
import { pendingRequestDerivedKeyPrefix, type PendingRequestId } from "../../domain/pending-requests/model";
import type { DisclosureSetAction } from "./actions";

export type ChatRenameUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "editing"; readonly threadId: string; readonly draft: string }
  | {
      readonly kind: "generating";
      readonly threadId: string;
      readonly draft: string;
      readonly originalDraft: string;
      readonly generationToken: number;
    };

export type ChatRenameGeneratingUiState = Extract<ChatRenameUiState, { kind: "generating" }>;
type ChatRenameUiAction = Extract<
  UiAction,
  {
    type:
      | "ui/rename-started"
      | "ui/rename-draft-updated"
      | "ui/rename-cancelled"
      | "ui/rename-generation-started"
      | "ui/rename-generation-succeeded"
      | "ui/rename-generation-finished"
      | "ui/rename-cleared";
  }
>;
type ChatRenameUiActionType = ChatRenameUiAction["type"];
type ChatRenameUiKind = ChatRenameUiState["kind"];
type ChatRenameUiTransition = (state: ChatRenameUiState, action: ChatRenameUiAction) => ChatRenameUiState;
type ChatRenameUiTransitionTable = Record<ChatRenameUiKind, Record<ChatRenameUiActionType, ChatRenameUiTransition>>;

type ChatGoalEditorUiState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "editing";
      readonly threadId: string | null;
      readonly objectiveDraft: string;
      readonly tokenBudgetDraft: number | null;
    };

interface ChatMessageActionMenuUiState {
  readonly forkMenuItemId: string | null;
}

const CHAT_DISCLOSURE_BUCKETS = [
  "details",
  "activityGroups",
  "textDetails",
  "userMessageExpanded",
  "goalObjectiveExpanded",
  "approvalDetails",
] as const;

export type ChatDisclosureBucket = (typeof CHAT_DISCLOSURE_BUCKETS)[number];

export type ChatDisclosureUiState = Readonly<Record<ChatDisclosureBucket, ReadonlySet<string>>>;

export interface ChatUiState {
  readonly toolbarPanel: "history" | "chat-actions" | "status-panel" | null;
  readonly archiveConfirmThreadId: string | null;
  readonly rename: ChatRenameUiState;
  readonly goalEditor: ChatGoalEditorUiState;
  readonly messageActionMenu: ChatMessageActionMenuUiState;
  readonly disclosures: ChatDisclosureUiState;
}

export type UiAction =
  | {
      type: "ui/panel-set";
      panel: "history" | "chat-actions" | "status-panel" | null;
      toggle?: boolean;
    }
  | { type: "ui/archive-confirm-set"; threadId: string | null }
  | { type: "ui/rename-started"; threadId: string; draft: string }
  | { type: "ui/rename-draft-updated"; threadId: string; draft: string }
  | { type: "ui/rename-cancelled"; threadId: string }
  | { type: "ui/rename-generation-started"; threadId: string; originalDraft: string; generationToken: number }
  | { type: "ui/rename-generation-succeeded"; generatingState: ChatRenameGeneratingUiState; draft: string }
  | { type: "ui/rename-generation-finished"; threadId: string; generatingState: ChatRenameGeneratingUiState }
  | { type: "ui/rename-cleared" }
  | { type: "ui/goal-editor-started"; threadId: string | null; objective: string; tokenBudget: number | null }
  | { type: "ui/goal-editor-draft-updated"; objective: string }
  | { type: "ui/goal-editor-closed" }
  | { type: "ui/message-fork-menu-set"; itemId: string | null }
  | DisclosureSetAction;

export function initialUiState(): ChatUiState {
  return {
    toolbarPanel: null,
    archiveConfirmThreadId: null,
    rename: initialRenameUiState(),
    goalEditor: initialGoalEditorUiState(),
    messageActionMenu: initialMessageActionMenuUiState(),
    disclosures: initialDisclosureUiState(),
  };
}

export function isUiAction(action: { type: string }): action is UiAction {
  switch (action.type) {
    case "ui/panel-set":
    case "ui/archive-confirm-set":
    case "ui/rename-started":
    case "ui/rename-draft-updated":
    case "ui/rename-cancelled":
    case "ui/rename-generation-started":
    case "ui/rename-generation-succeeded":
    case "ui/rename-generation-finished":
    case "ui/rename-cleared":
    case "ui/goal-editor-started":
    case "ui/goal-editor-draft-updated":
    case "ui/goal-editor-closed":
    case "ui/message-fork-menu-set":
    case "ui/disclosure-set":
      return true;
    default:
      return false;
  }
}

export function reduceUiSlice(state: ChatUiState, action: UiAction): ChatUiState {
  switch (action.type) {
    case "ui/panel-set":
      return setPanelSlice(state, action.panel, action.toggle ?? false);
    case "ui/archive-confirm-set":
      return patchObject(state, { archiveConfirmThreadId: action.threadId });
    case "ui/rename-started":
    case "ui/rename-draft-updated":
    case "ui/rename-cancelled":
    case "ui/rename-generation-started":
    case "ui/rename-generation-succeeded":
    case "ui/rename-generation-finished":
    case "ui/rename-cleared":
      return patchObject(state, { rename: transitionChatRenameUiState(state.rename, action) });
    case "ui/goal-editor-started":
      return patchObject(state, {
        goalEditor: {
          kind: "editing",
          threadId: action.threadId,
          objectiveDraft: action.objective,
          tokenBudgetDraft: action.tokenBudget,
        },
      });
    case "ui/goal-editor-draft-updated":
      return patchObject(state, { goalEditor: goalEditorDraftUpdated(state.goalEditor, action.objective) });
    case "ui/goal-editor-closed":
      return patchObject(state, { goalEditor: initialGoalEditorUiState() });
    case "ui/message-fork-menu-set":
      return patchObject(state, { messageActionMenu: { forkMenuItemId: action.itemId } });
    case "ui/disclosure-set":
      return setDisclosureSlice(state, action.bucket, action.id, action.open);
  }
}

export function cloneDisclosureUiState(state: ChatDisclosureUiState): ChatDisclosureUiState {
  return disclosureUiStateFrom((bucket) => new Set(state[bucket]));
}

export function maybeClearGoalObjectiveExpansion(
  state: ChatUiState,
  currentGoal: ThreadGoal | null,
  nextGoal: ThreadGoal | null,
): ChatUiState {
  if (goalObjectiveResetKey(currentGoal) === goalObjectiveResetKey(nextGoal)) return state;
  if (state.disclosures.goalObjectiveExpanded.size === 0) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      goalObjectiveExpanded: new Set(),
    },
  });
}

export function renameGenerationStillActive(
  state: ChatRenameUiState,
  generatingState: ChatRenameGeneratingUiState,
): state is ChatRenameGeneratingUiState {
  return (
    state.kind === "generating" &&
    state.threadId === generatingState.threadId &&
    state.originalDraft === generatingState.originalDraft &&
    state.generationToken === generatingState.generationToken
  );
}

export function clearAllRequestDisclosures(state: ChatUiState): ChatUiState {
  if (state.disclosures.approvalDetails.size === 0) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      approvalDetails: new Set(),
    },
  });
}

export function clearResolvedRequestDisclosures(state: ChatUiState, requestId: PendingRequestId): ChatUiState {
  const keyPrefix = pendingRequestDerivedKeyPrefix(requestId);
  const approvalDetails = filterStringSet(state.disclosures.approvalDetails, (key) => !key.startsWith(keyPrefix));
  if (approvalDetails === state.disclosures.approvalDetails) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      approvalDetails,
    },
  });
}

function setPanelSlice(state: ChatUiState, panel: "history" | "chat-actions" | "status-panel" | null, toggle: boolean): ChatUiState {
  const nextPanel = toggle && state.toolbarPanel === panel ? null : panel;
  return patchObject(state, { toolbarPanel: nextPanel });
}

function setDisclosureSlice(state: ChatUiState, bucket: ChatDisclosureBucket, id: string, open: boolean): ChatUiState {
  const current = state.disclosures[bucket];
  if (current.has(id) === open) return state;
  const nextBucket = new Set(current);
  if (open) {
    nextBucket.add(id);
  } else {
    nextBucket.delete(id);
  }
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      [bucket]: nextBucket,
    },
  });
}

function initialRenameUiState(): ChatRenameUiState {
  return { kind: "idle" };
}

function initialGoalEditorUiState(): ChatGoalEditorUiState {
  return { kind: "closed" };
}

function initialMessageActionMenuUiState(): ChatMessageActionMenuUiState {
  return { forkMenuItemId: null };
}

function initialDisclosureUiState(): ChatDisclosureUiState {
  return disclosureUiStateFrom(() => new Set());
}

function disclosureUiStateFrom(factory: (bucket: ChatDisclosureBucket) => ReadonlySet<string>): ChatDisclosureUiState {
  const disclosures = {} as Record<ChatDisclosureBucket, ReadonlySet<string>>;
  for (const bucket of CHAT_DISCLOSURE_BUCKETS) {
    disclosures[bucket] = factory(bucket);
  }
  return disclosures;
}

function goalObjectiveResetKey(goal: ThreadGoal | null): string {
  if (!goal) return "";
  return [goal.threadId, goal.objective, goal.status, String(goal.tokenBudget ?? "")].join("\u0000");
}

function goalEditorDraftUpdated(state: ChatGoalEditorUiState, objective: string): ChatGoalEditorUiState {
  if (state.kind !== "editing") return state;
  return { ...state, objectiveDraft: objective };
}

function transitionChatRenameUiState(state: ChatRenameUiState, action: ChatRenameUiAction): ChatRenameUiState {
  return chatRenameUiTransitions[state.kind][action.type](state, action);
}

const keepRenameUiState: ChatRenameUiTransition = (state) => state;

const startRenameUiTransition: ChatRenameUiTransition = (_state, action) => ({
  kind: "editing",
  threadId: requireRenameThreadId(action),
  draft: requireRenameDraft(action),
});

const updateRenameUiDraftTransition: ChatRenameUiTransition = (state, action) => {
  if (state.kind === "idle" || state.threadId !== requireRenameThreadId(action)) return state;
  return { ...state, draft: requireRenameDraft(action) };
};

const cancelRenameUiTransition: ChatRenameUiTransition = (state, action) => {
  const threadId = requireRenameThreadId(action);
  if (state.kind === "idle" || state.threadId !== threadId) return state;
  return initialRenameUiState();
};

const startRenameGenerationTransition: ChatRenameUiTransition = (state, action) => {
  const threadId = requireRenameThreadId(action);
  if (state.kind !== "editing" || state.threadId !== threadId) return state;
  return {
    kind: "generating",
    threadId,
    draft: state.draft,
    originalDraft: requireRenameOriginalDraft(action),
    generationToken: requireRenameGenerationToken(action),
  };
};

const succeedRenameGenerationTransition: ChatRenameUiTransition = (state, action) => {
  const generatingState = requireRenameGeneratingState(action);
  if (!renameGenerationStillActive(state, generatingState) || state.draft !== generatingState.originalDraft) return state;
  return { ...state, draft: requireRenameDraft(action) };
};

const finishRenameGenerationTransition: ChatRenameUiTransition = (state, action) => {
  const threadId = requireRenameThreadId(action);
  const generatingState = requireRenameGeneratingState(action);
  if (!renameGenerationStillActive(state, generatingState) || state.threadId !== threadId) return state;
  return {
    kind: "editing",
    threadId: state.threadId,
    draft: state.draft,
  };
};

const clearRenameUiTransition: ChatRenameUiTransition = (state) => (state.kind === "idle" ? state : initialRenameUiState());

const renameUiStateActiveTransitions = {
  "ui/rename-started": startRenameUiTransition,
  "ui/rename-draft-updated": updateRenameUiDraftTransition,
  "ui/rename-cancelled": cancelRenameUiTransition,
  "ui/rename-generation-started": startRenameGenerationTransition,
  "ui/rename-generation-succeeded": succeedRenameGenerationTransition,
  "ui/rename-generation-finished": finishRenameGenerationTransition,
  "ui/rename-cleared": clearRenameUiTransition,
} satisfies Record<ChatRenameUiActionType, ChatRenameUiTransition>;

const chatRenameUiTransitions: ChatRenameUiTransitionTable = {
  idle: {
    ...renameUiStateActiveTransitions,
    "ui/rename-draft-updated": keepRenameUiState,
    "ui/rename-cancelled": keepRenameUiState,
    "ui/rename-generation-started": keepRenameUiState,
    "ui/rename-generation-succeeded": keepRenameUiState,
    "ui/rename-generation-finished": keepRenameUiState,
    "ui/rename-cleared": clearRenameUiTransition,
  },
  editing: renameUiStateActiveTransitions,
  generating: {
    ...renameUiStateActiveTransitions,
    "ui/rename-generation-started": keepRenameUiState,
  },
};

function requireRenameThreadId(action: ChatRenameUiAction): string {
  if ("threadId" in action) return action.threadId;
  if ("generatingState" in action) return action.generatingState.threadId;
  throw new Error(`Rename UI action ${action.type} does not include a thread id.`);
}

function requireRenameDraft(action: ChatRenameUiAction): string {
  if ("draft" in action) return action.draft;
  throw new Error(`Rename UI action ${action.type} does not include a draft.`);
}

function requireRenameOriginalDraft(action: ChatRenameUiAction): string {
  if ("originalDraft" in action) return action.originalDraft;
  throw new Error(`Rename UI action ${action.type} does not include an original draft.`);
}

function requireRenameGenerationToken(action: ChatRenameUiAction): number {
  if ("generationToken" in action) return action.generationToken;
  throw new Error(`Rename UI action ${action.type} does not include a generation token.`);
}

function requireRenameGeneratingState(action: ChatRenameUiAction): ChatRenameGeneratingUiState {
  if ("generatingState" in action) return action.generatingState;
  throw new Error(`Rename UI action ${action.type} does not include generating state.`);
}

function filterStringSet(values: ReadonlySet<string>, keep: (value: string) => boolean): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const value of values) {
    if (keep(value)) {
      next?.add(value);
    } else if (next === null) {
      next = new Set();
      for (const kept of values) {
        if (kept === value) break;
        next.add(kept);
      }
    }
  }
  return next ?? values;
}

function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  return { ...current, ...patch };
}
