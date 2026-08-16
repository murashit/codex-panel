import type { ThreadGoal } from "../../../../domain/threads/goal";
import {
  type ThreadRenameActiveState,
  type ThreadRenameLifecycleEvent,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../../../domain/threads/rename-lifecycle";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import { pendingRequestDerivedKeyPrefix } from "../../domain/pending-requests/drafts";
import type { PendingRequestId } from "../../domain/pending-requests/model";
import { patchObject } from "./patch";

export type ChatRenameUiState = { readonly kind: "idle" } | (ThreadRenameActiveState & { readonly threadId: string });

type ChatRenameUiAction = Extract<
  UiAction,
  {
    type:
      | "ui/rename-started"
      | "ui/rename-draft-updated"
      | "ui/rename-auto-name-context-resolved"
      | "ui/rename-cancelled"
      | "ui/rename-save-started"
      | "ui/rename-save-failed"
      | "ui/rename-save-succeeded"
      | "ui/rename-generation-started"
      | "ui/rename-generation-succeeded"
      | "ui/rename-generation-finished"
      | "ui/rename-cleared";
  }
>;

type ChatGoalEditorUiState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "editing";
      readonly threadId: string | null;
      readonly objectiveDraft: string;
      readonly tokenBudgetDraft: number | null;
    };

interface ChatThreadStreamActionMenuUiState {
  readonly forkMenuItemId: string | null;
}

const CHAT_DISCLOSURE_BUCKETS = [
  "details",
  "activityGroups",
  "textDetails",
  "userDialogueExpanded",
  "goalObjectiveExpanded",
  "approvalDetails",
] as const;

type ChatDisclosureBucket = (typeof CHAT_DISCLOSURE_BUCKETS)[number];

type ChatDisclosureUiState = Readonly<Record<ChatDisclosureBucket, ReadonlySet<string>>>;

export interface ChatUiState {
  readonly toolbarPanel: "history" | "chat-actions" | "status-panel" | null;
  readonly archiveConfirmThreadId: string | null;
  readonly rename: ChatRenameUiState;
  readonly goalEditor: ChatGoalEditorUiState;
  readonly threadStreamActionMenu: ChatThreadStreamActionMenuUiState;
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
  | { type: "ui/rename-auto-name-context-resolved"; threadId: string; context: ThreadTitleContext | null }
  | { type: "ui/rename-cancelled"; threadId: string }
  | { type: "ui/rename-save-started"; threadId: string }
  | { type: "ui/rename-save-failed"; threadId: string }
  | { type: "ui/rename-save-succeeded"; threadId: string }
  | { type: "ui/rename-generation-started"; threadId: string }
  | { type: "ui/rename-generation-succeeded"; threadId: string; draft: string }
  | { type: "ui/rename-generation-finished"; threadId: string }
  | { type: "ui/rename-cleared" }
  | { type: "ui/goal-editor-started"; threadId: string | null; objective: string; tokenBudget: number | null }
  | { type: "ui/goal-editor-draft-updated"; objective: string }
  | { type: "ui/goal-editor-closed" }
  | { type: "ui/thread-stream-fork-menu-set"; itemId: string | null }
  | {
      type: "ui/disclosure-set";
      bucket: "details" | "activityGroups" | "textDetails" | "userDialogueExpanded" | "goalObjectiveExpanded" | "approvalDetails";
      id: string;
      open: boolean;
    };

export function initialUiState(): ChatUiState {
  return {
    toolbarPanel: null,
    archiveConfirmThreadId: null,
    rename: initialRenameUiState(),
    goalEditor: initialGoalEditorUiState(),
    threadStreamActionMenu: initialThreadStreamActionMenuUiState(),
    disclosures: initialDisclosureUiState(),
  };
}

export function isUiAction(action: { type: string }): action is UiAction {
  switch (action.type) {
    case "ui/panel-set":
    case "ui/archive-confirm-set":
    case "ui/rename-started":
    case "ui/rename-draft-updated":
    case "ui/rename-auto-name-context-resolved":
    case "ui/rename-cancelled":
    case "ui/rename-save-started":
    case "ui/rename-save-failed":
    case "ui/rename-save-succeeded":
    case "ui/rename-generation-started":
    case "ui/rename-generation-succeeded":
    case "ui/rename-generation-finished":
    case "ui/rename-cleared":
    case "ui/goal-editor-started":
    case "ui/goal-editor-draft-updated":
    case "ui/goal-editor-closed":
    case "ui/thread-stream-fork-menu-set":
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
    case "ui/rename-auto-name-context-resolved":
    case "ui/rename-cancelled":
    case "ui/rename-save-started":
    case "ui/rename-save-failed":
    case "ui/rename-save-succeeded":
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
    case "ui/thread-stream-fork-menu-set":
      return patchObject(state, { threadStreamActionMenu: { forkMenuItemId: action.itemId } });
    case "ui/disclosure-set":
      return setDisclosureSlice(state, action.bucket, action.id, action.open);
  }
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

function initialThreadStreamActionMenuUiState(): ChatThreadStreamActionMenuUiState {
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
  switch (action.type) {
    case "ui/rename-started":
      if (state.kind === "saving") return state;
      return { kind: "editing", threadId: action.threadId, draft: action.draft, autoName: { kind: "checking" } };
    case "ui/rename-draft-updated":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "draft-updated", draft: action.draft });
    case "ui/rename-auto-name-context-resolved":
      return transitionScopedChatRenameUiState(state, action.threadId, {
        type: "auto-name-context-resolved",
        context: action.context,
      });
    case "ui/rename-cancelled":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "cancelled" });
    case "ui/rename-save-started":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "save-started" });
    case "ui/rename-save-failed":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "save-failed" });
    case "ui/rename-save-succeeded":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "save-succeeded" });
    case "ui/rename-generation-started":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "generation-started" });
    case "ui/rename-generation-succeeded":
      return transitionScopedChatRenameUiState(state, action.threadId, {
        type: "generation-succeeded",
        draft: action.draft,
      });
    case "ui/rename-generation-finished":
      return transitionScopedChatRenameUiState(state, action.threadId, { type: "generation-finished" });
    case "ui/rename-cleared":
      return chatRenameUiStateFromThreadRenameState(
        state.kind === "idle" ? null : state.threadId,
        transitionThreadRenameLifecycleState(chatRenameLifecycleStateWithoutThreadId(state), { type: "cleared" }),
      );
    default:
      return unhandledChatRenameUiAction(action);
  }
}

function transitionScopedChatRenameUiState(
  state: ChatRenameUiState,
  threadId: string,
  event: ThreadRenameLifecycleEvent,
): ChatRenameUiState {
  if (state.kind === "idle" || state.threadId !== threadId) return state;
  const lifecycleState = chatRenameLifecycleStateWithoutThreadId(state);
  const nextLifecycleState = transitionThreadRenameLifecycleState(lifecycleState, event);
  if (nextLifecycleState === lifecycleState) return state;
  return chatRenameUiStateFromThreadRenameState(threadId, nextLifecycleState);
}

function chatRenameLifecycleStateWithoutThreadId(state: ChatRenameUiState): ThreadRenameLifecycleState {
  if (state.kind === "idle") return state;
  return chatRenameActiveStateWithoutThreadId(state);
}

function chatRenameActiveStateWithoutThreadId(state: Exclude<ChatRenameUiState, { kind: "idle" }>): ThreadRenameActiveState {
  switch (state.kind) {
    case "editing":
      return { kind: "editing", draft: state.draft, autoName: state.autoName };
    case "saving":
      return { kind: "saving", draft: state.draft, autoName: state.autoName };
    case "generating":
      return { kind: "generating", draft: state.draft, autoName: state.autoName };
  }
}

function chatRenameUiStateFromThreadRenameState(threadId: string | null, state: ThreadRenameLifecycleState): ChatRenameUiState {
  if (state.kind === "idle") return state;
  if (threadId === null) return initialRenameUiState();
  return { ...state, threadId };
}

function unhandledChatRenameUiAction(action: never): never {
  throw new Error(`Unhandled chat rename UI action: ${String(action)}`);
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
