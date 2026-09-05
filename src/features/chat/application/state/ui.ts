import type { ThreadRenameActiveState } from "../../../../domain/threads/rename-lifecycle";
import { pendingRequestDerivedKeyPrefix } from "../../domain/pending-requests/drafts";
import type { PendingRequestId } from "../../domain/pending-requests/model";
import { patchObject } from "./patch";

type ChatRenameUiState = { readonly kind: "idle" } | (ThreadRenameActiveState & { readonly threadId: string });

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
  | { type: "ui/rename-set"; threadId: string | null; state: ThreadRenameActiveState | undefined }
  | { type: "ui/goal-editor-started"; threadId: string | null; objective: string; tokenBudget: number | null }
  | { type: "ui/goal-editor-draft-updated"; objective: string }
  | { type: "ui/goal-editor-closed" }
  | { type: "ui/thread-stream-fork-menu-set"; itemId: string | null }
  | {
      type: "ui/disclosure-set";
      bucket: ChatDisclosureBucket;
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
    case "ui/rename-set":
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
    case "ui/rename-set":
      return patchObject(state, { rename: chatRenameUiState(action.threadId, action.state) });
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
  const disclosures = {} as Record<ChatDisclosureBucket, ReadonlySet<string>>;
  for (const bucket of CHAT_DISCLOSURE_BUCKETS) {
    disclosures[bucket] = new Set();
  }
  return disclosures;
}

function goalEditorDraftUpdated(state: ChatGoalEditorUiState, objective: string): ChatGoalEditorUiState {
  if (state.kind !== "editing") return state;
  return { ...state, objectiveDraft: objective };
}

function chatRenameUiState(threadId: string | null, state: ThreadRenameActiveState | undefined): ChatRenameUiState {
  if (threadId === null || state === undefined) return initialRenameUiState();
  return { ...state, threadId };
}

function filterStringSet(values: ReadonlySet<string>, keep: (value: string) => boolean): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const value of values) {
    if (keep(value)) continue;
    next ??= new Set(values);
    next.delete(value);
  }
  return next ?? values;
}
