import type { ModelMetadata, ReasoningEffort, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { PendingRequestId } from "../../../../domain/pending-requests/model";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { Diagnostics } from "../../../../domain/server/diagnostics";
import { createServerDiagnostics, diagnosticsWithMetadataResourceProbes } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { Thread } from "../../../../domain/threads/model";
import { type CollaborationModeSelection, type RequestedFastMode, unchangedCollaborationModeIntent } from "../../domain/runtime/intent";
import {
  type ChatRuntimeState,
  clearRequestedApprovalsReviewerRuntimeState,
  clearRequestedFastModeRuntimeState,
  commitAppliedRuntimeSettingsPatchState,
  initialActiveChatRuntimeState,
  initialChatRuntimeState,
  requestApprovalsReviewerRuntimeState,
  requestFastModeRuntimeState,
  requestModelRuntimeState,
  requestPermissionProfileRuntimeState,
  requestReasoningEffortRuntimeState,
  resetModelToConfigRuntimeState,
  resetPermissionProfileToConfigRuntimeState,
  resetReasoningEffortToConfigRuntimeState,
  setSelectedCollaborationModeRuntimeState,
} from "../../domain/runtime/state";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import type { ComposerSuggestion } from "../composer/suggestions";
import {
  type ChatRequestState,
  initialChatRequestState,
  isRequestAction,
  type RequestAction,
  reduceRequestSlice,
  resolveChatRequest,
} from "../pending-requests/state";
import {
  type ChatTurnState,
  initialChatTurnState,
  type PendingTurnStart,
  STATUS_TURN_RUNNING,
  transitionChatTurnLifecycleState,
} from "../turns/turn-state";
import type {
  ActiveThreadResumedAction,
  ActiveThreadSettingsAppliedAction,
  ClearActiveThreadAction,
  ClearDisconnectedConnectionStateAction,
  ClearLocalTurnAction,
  ConnectionInitializedAction,
  ReplaceConnectionContextAction,
  ThreadListAppliedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartFailedAction,
} from "./actions";
import { definedPatch, patchObject } from "./patch";
import type { ChatPendingSubmissionState, PendingSubmissionAction } from "./pending-submission";
import {
  type ChatSubagentActivityState,
  initialSubagentActivityState,
  isSubagentActivityAction,
  reduceSubagentActivitySlice,
  type SubagentActivityAction,
  subagentActivityWithParentTurn,
} from "./subagent-activity";
import {
  type ChatThreadStreamState,
  initialChatThreadStreamState,
  isThreadStreamAction,
  reduceThreadStreamSlice,
  type ThreadStreamAction,
  threadStreamItems,
  threadStreamStartActiveSegment,
  threadStreamWithActiveTurnItems,
  threadStreamWithItems,
} from "./thread-stream";
import {
  type ChatUiState,
  clearAllRequestDisclosures,
  clearResolvedRequestDisclosures,
  initialUiState,
  isUiAction,
  maybeClearGoalObjectiveExpansion,
  reduceUiSlice,
  type UiAction,
} from "./ui-state";

export type ChatConnectionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string }
  | { kind: "disconnected"; message: string };

interface ChatConnectionState {
  readonly phase: ChatConnectionPhase;
  readonly statusText: string;
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly initializeResponse: ServerInitialization | null;
  readonly rateLimit: RateLimitSnapshot | null;
  readonly serverDiagnostics: Diagnostics;
  readonly availableModels: readonly ModelMetadata[];
  readonly availableSkills: readonly SkillMetadata[];
  readonly availablePermissionProfiles: readonly RuntimePermissionProfileSummary[];
}

interface ChatThreadListState {
  readonly listedThreads: readonly Thread[];
  readonly hasMore: boolean;
  readonly isFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly error: string | null;
}

export interface ChatActiveThreadState {
  readonly id: string;
  readonly title?: string | null;
  readonly goal: ThreadGoal | null;
  readonly tokenUsage: ThreadTokenUsage | null;
  readonly lifetime: ActiveThreadLifetime | null;
  readonly canAcceptDirectInput: boolean | null;
  readonly provenance: Thread["provenance"] | null;
}

type ChatPanelThreadState =
  | { readonly kind: "empty" }
  | {
      readonly kind: "awaiting-resume";
      readonly threadId: string;
      readonly fallbackTitle: string | null;
      readonly provenance: Thread["provenance"] | null;
    }
  | { readonly kind: "active"; readonly thread: ChatActiveThreadState };

type ActiveThreadLifetime =
  | { readonly kind: "persistent" }
  | { readonly kind: "ephemeral"; readonly sourceThreadId: string; readonly sourceThreadTitle: string | null };

interface ChatComposerState {
  readonly draft: string;
  readonly pendingAttachmentSaveIds: readonly number[];
  readonly suggestSelected: number;
  readonly suggestions: readonly ComposerSuggestion[];
  readonly suggestionsDismissedSignature: string | null;
}

interface ChatStateShape {
  connection: ChatConnectionState;
  threadList: ChatThreadListState;
  panelThread: ChatPanelThreadState;
  panelTargetRevision: number;
  runtime: ChatRuntimeState;
  turn: ChatTurnState;
  threadStream: ChatThreadStreamState;
  subagentActivity: ChatSubagentActivityState;
  pendingSubmission: ChatPendingSubmissionState | null;
  requests: ChatRequestState;
  composer: ChatComposerState;
  ui: ChatUiState;
}

export type ChatState = DeepReadonly<ChatStateShape>;

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | ConnectionInitializedAction
  | {
      type: "connection/metadata-applied";
      runtimeConfig?: RuntimeConfigSnapshot | null;
      availableModels?: readonly ModelMetadata[];
      availableSkills?: readonly SkillMetadata[];
      availablePermissionProfiles?: readonly RuntimePermissionProfileSummary[];
      rateLimit?: RateLimitSnapshot | null;
      serverDiagnostics?: Diagnostics;
    };

type ThreadListAction = ThreadListAppliedAction;

type ActiveThreadAction = { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/model-requested"; model: string }
  | { type: "runtime/model-reset-to-config" }
  | { type: "runtime/reasoning-effort-requested"; effort: ReasoningEffort }
  | { type: "runtime/reasoning-effort-reset-to-config" }
  | { type: "runtime/permission-profile-requested"; permissionProfile: string }
  | { type: "runtime/permission-profile-reset-to-config" }
  | { type: "runtime/fast-mode-requested"; fastMode: RequestedFastMode }
  | { type: "runtime/fast-mode-request-cleared" }
  | { type: "runtime/approvals-reviewer-requested"; approvalsReviewer: ApprovalsReviewer }
  | { type: "runtime/approvals-reviewer-request-cleared" }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: CollaborationModeSelection }
  | { type: "runtime/pending-thread-settings-committed"; update: RuntimeSettingsPatch };

interface TurnStartedAction {
  type: "turn/started";
  threadId: string;
  turnId: string;
  items?: readonly ThreadStreamItem[];
}

interface TurnCompletedAction {
  type: "turn/completed";
  turnId: string;
  status: string;
  items: readonly ThreadStreamItem[];
}

type TurnAction =
  | TurnStartedAction
  | TurnCompletedAction
  | ClearLocalTurnAction
  | TurnOptimisticStartedAction
  | TurnStartAcknowledgedAction
  | TurnStartFailedAction;

type ComposerAction =
  | {
      type: "composer/attachment-save-started";
      saveId: number;
      draft: string;
    }
  | {
      type: "composer/attachment-save-settled";
      saveId: number;
      draft?: string;
    }
  | {
      type: "composer/draft-set";
      draft: string;
      clearSuggestions?: boolean;
      resetDismissedSignature?: boolean;
    }
  | {
      type: "composer/input-set";
      draft: string;
      suggestions: readonly ComposerSuggestion[];
      selected?: number;
      dismissedSignature?: string | null;
    }
  | {
      type: "composer/suggestions-set";
      suggestions: readonly ComposerSuggestion[];
      selected?: number;
      dismissedSignature?: string | null;
    };

export type ChatAction = ChatTransitionAction | ChatSliceAction;

interface RequestResolvedAction {
  type: "request/resolved";
  requestId: PendingRequestId;
  resultItem?: ThreadStreamItem;
}

interface PendingStartHookUpsertedAction {
  type: "turn/pending-start-hook-upserted";
  item: ThreadStreamItem;
  pendingTurnStart: PendingTurnStart | null;
}

type ChatTransitionAction =
  | ClearDisconnectedConnectionStateAction
  | ReplaceConnectionContextAction
  | ClearActiveThreadAction
  | ActiveThreadResumedAction
  | ActiveThreadSettingsAppliedAction
  | { type: "active-thread/goal-set"; goal: ThreadGoal | null }
  | { type: "panel/restored-thread-applied"; threadId: string; fallbackTitle: string | null }
  | { type: "panel/restored-thread-renamed"; threadId: string; name: string | null }
  | { type: "panel/view-state-cleared" }
  | TurnAction
  | RequestResolvedAction
  | PendingStartHookUpsertedAction
  | PendingSubmissionAction;

type ChatSliceAction =
  | ConnectionAction
  | ThreadListAction
  | ActiveThreadAction
  | RuntimeAction
  | RequestAction
  | ThreadStreamAction
  | SubagentActivityAction
  | ComposerAction
  | UiAction;

export function createChatState(): ChatState {
  return {
    connection: initialConnectionState(),
    threadList: initialThreadListState(),
    panelThread: initialPanelThreadState(),
    panelTargetRevision: 0,
    runtime: initialChatRuntimeState(),
    turn: initialTurnState(),
    threadStream: initialThreadStreamState(),
    subagentActivity: initialSubagentActivityState(),
    pendingSubmission: null,
    requests: initialRequestState(),
    composer: initialComposerState(),
    ui: initialUiState(),
  };
}

export function panelThreadId(state: ChatState): string | null {
  return state.panelThread.kind === "awaiting-resume" ? state.panelThread.threadId : activeThreadId(state);
}

export function activeThreadId(state: ChatState): string | null {
  return activeThreadState(state)?.id ?? null;
}

export function activeThreadState(state: ChatState): DeepReadonly<ChatActiveThreadState> | null {
  return state.panelThread.kind === "active" ? state.panelThread.thread : null;
}

export function awaitingResumeThreadState(state: ChatState): Extract<ChatState["panelThread"], { kind: "awaiting-resume" }> | null {
  return state.panelThread.kind === "awaiting-resume" ? state.panelThread : null;
}

export function panelThreadProvenance(state: ChatState): ChatActiveThreadState["provenance"] {
  if (state.panelThread.kind === "active") return state.panelThread.thread.provenance;
  return state.panelThread.kind === "awaiting-resume" ? state.panelThread.provenance : null;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
    case "connection/context-replaced":
    case "active-thread/cleared":
    case "active-thread/resumed":
    case "active-thread/settings-applied":
    case "active-thread/goal-set":
    case "panel/restored-thread-applied":
    case "panel/restored-thread-renamed":
    case "panel/view-state-cleared":
    case "turn/started":
    case "turn/completed":
    case "turn/scoped-cleared":
    case "turn/optimistic-started":
    case "turn/start-acknowledged":
    case "turn/start-failed":
    case "turn/pending-start-hook-upserted":
    case "request/resolved":
    case "web-submission/pending":
    case "web-submission/committed":
    case "web-submission/cancelled":
    case "web-submission/failed":
    case "web-submission/steer-adopted":
      return reduceChatTransition(state, action);
    default:
      return reduceChatSlices(state, action);
  }
}

function reduceChatTransition(state: ChatState, action: ChatTransitionAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
      return clearConnectionScopedState(state);
    case "connection/context-replaced":
      return clearConnectionContextState(state);
    case "active-thread/cleared":
      if (action.expectedPanelTargetRevision !== undefined && action.expectedPanelTargetRevision !== state.panelTargetRevision) {
        return state;
      }
      return clearThreadScopedState(state, { invalidatePanelTarget: true });
    case "active-thread/resumed":
      return reduceActiveThreadResumedTransition(state, action);
    case "active-thread/settings-applied":
      return reduceActiveThreadSettingsAppliedTransition(state, action);
    case "active-thread/goal-set":
      return reduceActiveThreadGoalSetTransition(state, action.goal);
    case "panel/restored-thread-applied":
      return reduceRestoredThreadAppliedTransition(state, action.threadId, action.fallbackTitle);
    case "panel/restored-thread-renamed":
      return reduceRestoredThreadRenamedTransition(state, action.threadId, action.name);
    case "panel/view-state-cleared":
      return reduceViewStateClearedTransition(state);
    case "turn/started":
      return reduceTurnStartedTransition(state, action);
    case "turn/completed":
      return reduceTurnCompletedTransition(state, action);
    case "turn/scoped-cleared":
      return clearTurnScopedState(state);
    case "turn/optimistic-started":
      return reduceTurnOptimisticStartedTransition(state, action);
    case "turn/start-acknowledged":
      return reduceTurnStartAcknowledgedTransition(state, action);
    case "turn/start-failed":
      return reduceTurnStartFailedTransition(state, action);
    case "turn/pending-start-hook-upserted":
      return reducePendingStartHookUpsertedTransition(state, action);
    case "request/resolved":
      return reduceRequestResolvedTransition(state, action);
    case "web-submission/pending":
      return patchChatState(state, { pendingSubmission: action.submission });
    case "web-submission/committed":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "cancellable"
        ? patchChatState(state, { pendingSubmission: { ...state.pendingSubmission, phase: "committed" } })
        : state;
    case "web-submission/cancelled":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "cancellable"
        ? patchChatState(state, { pendingSubmission: null })
        : state;
    case "web-submission/failed":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "committed"
        ? patchChatState(state, { pendingSubmission: null })
        : state;
    case "web-submission/steer-adopted":
      if (state.pendingSubmission?.id !== action.submissionId || state.pendingSubmission.phase !== "committed") return state;
      return patchChatState(state, {
        pendingSubmission: null,
        threadStream: adoptPendingSteerItem(state.threadStream, action.item),
      });
  }
}

function adoptPendingSteerItem(state: ChatThreadStreamState, item: ThreadStreamDialogueItem): ChatThreadStreamState {
  if (!item.clientId) {
    return reduceThreadStreamSlice(state, { type: "thread-stream/item-added", item });
  }
  const matchedIndex = state.stableItems.findIndex(
    (current) => current.kind === "dialogue" && current.role === "user" && current.clientId === item.clientId,
  );
  if (matchedIndex === -1) return reduceThreadStreamSlice(state, { type: "thread-stream/item-added", item });
  const current = state.stableItems[matchedIndex];
  if (current?.kind !== "dialogue") return state;
  const stableItems = [...state.stableItems];
  stableItems[matchedIndex] = {
    ...current,
    ...(item.contextAttachments ? { contextAttachments: item.contextAttachments } : {}),
    ...(item.referencedFiles ? { referencedFiles: item.referencedFiles } : {}),
    ...(item.referencedThread ? { referencedThread: item.referencedThread } : {}),
  };
  return { ...state, stableItems };
}

function reduceActiveThreadResumedTransition(state: ChatState, action: ActiveThreadResumedAction): ChatState {
  if (action.expectedPanelTargetRevision !== undefined && action.expectedPanelTargetRevision !== state.panelTargetRevision) {
    return state;
  }
  const runtimeBase = action.preserveRequestedRuntimeSettings ? state.runtime : initialChatRuntimeState();
  const turnScopedState = clearTurnScopedState(state);
  const nextPanelTargetRevision = panelThreadId(state) === action.thread.id ? state.panelTargetRevision : state.panelTargetRevision + 1;
  return patchChatState(turnScopedState, {
    connection: {
      ...state.connection,
      statusText: action.status ?? state.connection.statusText,
    },
    threadList: {
      ...state.threadList,
      listedThreads: action.listedThreads ?? state.threadList.listedThreads,
    },
    panelThread: {
      kind: "active",
      thread: {
        id: action.thread.id,
        title: (action.thread.name ?? action.thread.preview) || null,
        goal: null,
        tokenUsage: null,
        lifetime: action.lifetime ?? { kind: "persistent" },
        canAcceptDirectInput: action.thread.canAcceptDirectInput ?? null,
        provenance: action.thread.provenance,
      },
    },
    panelTargetRevision: nextPanelTargetRevision,
    runtime: {
      ...runtimeBase,
      active: {
        serviceTierKnown: action.serviceTierKnown ?? true,
        model: action.model,
        reasoningEffort: action.reasoningEffort,
        collaborationMode: initialActiveChatRuntimeState().collaborationMode,
        serviceTier: action.serviceTier,
        approvalsReviewer: action.approvalsReviewer,
        approvalPolicyKnown: action.approvalPolicyKnown,
        sandboxPolicyKnown: action.sandboxPolicyKnown,
        permissionProfileKnown: action.permissionProfileKnown,
        approvalPolicy: action.approvalPolicy,
        sandboxPolicy: action.sandboxPolicy,
        activePermissionProfile: action.activePermissionProfile,
      },
    },
    turn: initialTurnState(),
    threadStream: initialThreadStreamState(action.items ?? []),
    pendingSubmission:
      action.preservePendingSubmissionId && state.pendingSubmission?.id === action.preservePendingSubmissionId
        ? { ...state.pendingSubmission, targetThreadId: action.thread.id }
        : null,
    requests: initialRequestState(),
    composer: initialComposerState(),
    ui: initialUiState(),
  });
}

function reduceActiveThreadSettingsAppliedTransition(state: ChatState, action: ActiveThreadSettingsAppliedAction): ChatState {
  if (!activeThreadState(state)) return state;
  return patchChatState(state, {
    runtime: {
      ...state.runtime,
      active: {
        serviceTierKnown: true,
        model: action.model,
        reasoningEffort: action.reasoningEffort,
        collaborationMode: action.collaborationMode,
        serviceTier: action.serviceTier,
        approvalsReviewer: action.approvalsReviewer,
        approvalPolicyKnown: action.approvalPolicyKnown,
        sandboxPolicyKnown: action.sandboxPolicyKnown,
        permissionProfileKnown: action.permissionProfileKnown,
        approvalPolicy: action.approvalPolicy,
        sandboxPolicy: action.sandboxPolicy,
        activePermissionProfile: action.activePermissionProfile,
      },
      pending: {
        ...state.runtime.pending,
        collaborationMode: unchangedCollaborationModeIntent(),
      },
    },
  });
}

function reduceActiveThreadGoalSetTransition(state: ChatState, goal: ThreadGoal | null): ChatState {
  const activeThread = activeThreadState(state);
  if (!activeThread) return state;
  return patchChatState(state, {
    panelThread: { kind: "active", thread: { ...activeThread, goal } },
    ui: maybeClearGoalObjectiveExpansion(state.ui, activeThread.goal, goal),
  });
}

function reduceRestoredThreadAppliedTransition(state: ChatState, threadId: string, fallbackTitle: string | null): ChatState {
  const cleared = clearThreadScopedState(state, { invalidatePanelTarget: true });
  return patchChatState(cleared, {
    connection: { ...cleared.connection, statusText: "Thread ready to resume." },
    panelThread: createAwaitingResumeThreadState(threadId, fallbackTitle),
  });
}

function reduceRestoredThreadRenamedTransition(state: ChatState, threadId: string, name: string | null): ChatState {
  if (state.panelThread.kind !== "awaiting-resume" || state.panelThread.threadId !== threadId) return state;
  return patchChatState(state, { panelThread: { ...state.panelThread, fallbackTitle: name } });
}

function reduceViewStateClearedTransition(state: ChatState): ChatState {
  const cleared = clearThreadScopedState(state, { invalidatePanelTarget: true });
  return patchChatState(cleared, { connection: { ...cleared.connection, statusText: "Idle" } });
}

function reduceTurnStartedTransition(state: ChatState, action: TurnStartedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "started", turnId: action.turnId });
  if (lifecycle === state.turn.lifecycle) return state;
  const activeThread =
    activeThreadState(state) ?? (state.turn.lifecycle.kind === "starting" ? createActiveThreadState(action.threadId) : null);
  if (!activeThread || activeThread.id !== action.threadId) return state;
  return patchChatState(state, {
    panelThread: { kind: "active", thread: activeThread },
    panelTargetRevision: panelThreadId(state) === action.threadId ? state.panelTargetRevision : state.panelTargetRevision + 1,
    turn: { lifecycle },
    connection: { ...state.connection, statusText: STATUS_TURN_RUNNING },
    threadStream: action.items
      ? threadStreamWithActiveTurnItems(state.threadStream, action.turnId, action.items)
      : threadStreamStartActiveSegment(state.threadStream, action.turnId, []),
    subagentActivity: initialSubagentActivityState(action.turnId),
  });
}

function reduceTurnCompletedTransition(state: ChatState, action: TurnCompletedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "completed", turnId: action.turnId });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    threadStream: threadStreamWithItems(state.threadStream, action.items),
    subagentActivity: initialSubagentActivityState(),
    connection: { ...state.connection, statusText: `Turn ${action.status}.` },
  });
}

function reduceTurnOptimisticStartedTransition(state: ChatState, action: TurnOptimisticStartedAction): ChatState {
  if (
    action.pendingSubmissionId &&
    (state.pendingSubmission?.id !== action.pendingSubmissionId || state.pendingSubmission.phase !== "committed")
  ) {
    return state;
  }
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, {
    type: "optimistic-started",
    pendingTurnStart: action.pendingTurnStart,
  });
  return patchChatState(state, {
    turn: { lifecycle },
    pendingSubmission: action.pendingSubmissionId ? null : state.pendingSubmission,
    threadStream: threadStreamStartActiveSegment(state.threadStream, null, [action.item]),
    subagentActivity: initialSubagentActivityState(),
  });
}

function reduceTurnStartAcknowledgedTransition(state: ChatState, action: TurnStartAcknowledgedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, {
    type: "start-acknowledged",
    turnId: action.turnId,
  });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    threadStream: threadStreamWithActiveTurnItems(state.threadStream, action.turnId, action.items),
    subagentActivity: subagentActivityWithParentTurn(state.subagentActivity, action.turnId),
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "start-failed" });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    threadStream: threadStreamWithItems(state.threadStream, action.items),
    subagentActivity: initialSubagentActivityState(),
  });
}

function reducePendingStartHookUpsertedTransition(state: ChatState, action: PendingStartHookUpsertedAction): ChatState {
  return patchChatState(state, {
    threadStream: reduceThreadStreamSlice(state.threadStream, { type: "thread-stream/item-upserted", item: action.item }),
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, {
        type: "pending-start-hook-upserted",
        pendingTurnStart: action.pendingTurnStart,
      }),
    },
  });
}

function reduceRequestResolvedTransition(state: ChatState, action: RequestResolvedAction): ChatState {
  const requests = resolveChatRequest(state.requests, action.requestId);
  if (requests === state.requests) return state;
  return patchChatState(state, {
    requests,
    ui: clearResolvedRequestDisclosures(state.ui, action.requestId),
    threadStream: action.resultItem
      ? reduceThreadStreamSlice(state.threadStream, { type: "thread-stream/item-added", item: action.resultItem })
      : state.threadStream,
  });
}

function clearTurnScopedState(state: ChatState): ChatState {
  return patchChatState(state, {
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "cleared" }),
    },
    threadStream: threadStreamWithItems(state.threadStream, threadStreamItems(state.threadStream)),
    subagentActivity: initialSubagentActivityState(),
    requests: initialRequestState(),
    ui: clearAllRequestDisclosures(state.ui),
  });
}

function clearThreadScopedState(state: ChatState, options: { invalidatePanelTarget?: boolean } = {}): ChatState {
  return clearTurnScopedState(
    patchChatState(state, {
      panelThread: initialPanelThreadState(),
      panelTargetRevision:
        options.invalidatePanelTarget || panelThreadId(state) !== null ? state.panelTargetRevision + 1 : state.panelTargetRevision,
      runtime: initialChatRuntimeState(),
      threadStream: initialThreadStreamState(),
      pendingSubmission: null,
      composer: initialComposerState(),
      ui: initialUiState(),
    }),
  );
}

function clearConnectionScopedState(state: ChatState): ChatState {
  const cleared = clearTurnScopedState(state);
  const ephemeralExpired = state.panelThread.kind === "active" && state.panelThread.thread.lifetime?.kind === "ephemeral";
  const nextPanelThread = panelThreadAfterConnectionExit(state.panelThread);
  return patchChatState(cleared, {
    panelThread: nextPanelThread,
    panelTargetRevision:
      panelThreadIdForState(nextPanelThread) === panelThreadId(state) ? state.panelTargetRevision : state.panelTargetRevision + 1,
    runtime: initialChatRuntimeState(),
    connection: {
      ...state.connection,
      serverDiagnostics: diagnosticsWithMetadataResourceProbes(createServerDiagnostics(), state.connection.serverDiagnostics),
    },
    threadStream: ephemeralExpired ? initialThreadStreamState() : cleared.threadStream,
    pendingSubmission: null,
    composer:
      state.pendingSubmission?.phase === "cancellable"
        ? { ...initialComposerState(), draft: state.pendingSubmission.originalDraft }
        : state.composer,
  });
}

function clearConnectionContextState(state: ChatState): ChatState {
  const cleared = clearConnectionScopedState(state);
  return patchChatState(cleared, {
    panelThread: initialPanelThreadState(),
    panelTargetRevision: state.panelTargetRevision + 1,
    connection: {
      ...cleared.connection,
      runtimeConfig: null,
      initializeResponse: null,
      serverDiagnostics: createServerDiagnostics(),
      rateLimit: null,
      availableModels: [],
      availableSkills: [],
      availablePermissionProfiles: [],
    },
    threadList: initialThreadListState(),
    threadStream: initialThreadStreamState(),
  });
}

function panelThreadAfterConnectionExit(panelThread: ChatPanelThreadState): ChatPanelThreadState {
  if (panelThread.kind === "awaiting-resume") return panelThread;
  if (panelThread.kind !== "active" || panelThread.thread.lifetime?.kind === "ephemeral") return initialPanelThreadState();
  return createAwaitingResumeThreadState(panelThread.thread.id, panelThread.thread.title ?? null, panelThread.thread.provenance);
}

function panelThreadIdForState(panelThread: ChatPanelThreadState): string | null {
  if (panelThread.kind === "awaiting-resume") return panelThread.threadId;
  return panelThread.kind === "active" ? panelThread.thread.id : null;
}

function reduceChatSlices(state: ChatState, action: ChatSliceAction): ChatState {
  return patchChatState(state, {
    connection: reduceConnectionSlice(state.connection, action),
    threadList: reduceThreadListSlice(state.threadList, action),
    panelThread: reducePanelThreadSlice(state.panelThread, action),
    panelTargetRevision: state.panelTargetRevision,
    runtime: reduceRuntimeSlice(state.runtime, action),
    turn: state.turn,
    pendingSubmission: state.pendingSubmission,
    requests: isRequestAction(action) ? reduceRequestSlice(state.requests, action) : state.requests,
    threadStream: isThreadStreamAction(action) ? reduceThreadStreamSlice(state.threadStream, action) : state.threadStream,
    subagentActivity: isSubagentActivityAction(action)
      ? reduceSubagentActivitySlice(state.subagentActivity, action)
      : state.subagentActivity,
    composer: reduceComposerSlice(state.composer, action),
    ui: isUiAction(action) ? reduceUiSlice(state.ui, action) : state.ui,
  });
}

function reduceConnectionSlice(state: ChatConnectionState, action: ChatSliceAction): ChatConnectionState {
  switch (action.type) {
    case "connection/status-set":
      return patchObject(state, { statusText: action.statusText, ...definedPatch("phase", action.phase) });
    case "connection/initialized":
      return patchObject(state, { initializeResponse: action.initializeResponse });
    case "connection/metadata-applied":
      return patchObject(state, {
        ...definedPatch("runtimeConfig", action.runtimeConfig),
        ...definedPatch("availableModels", action.availableModels),
        ...definedPatch("availableSkills", action.availableSkills),
        ...definedPatch("availablePermissionProfiles", action.availablePermissionProfiles),
        ...definedPatch("rateLimit", action.rateLimit),
        ...definedPatch("serverDiagnostics", action.serverDiagnostics),
      });
    default:
      return state;
  }
}

function reduceThreadListSlice(state: ChatThreadListState, action: ChatSliceAction): ChatThreadListState {
  if (action.type !== "thread-list/applied") return state;
  return patchObject(state, {
    listedThreads: action.threads,
    ...definedPatch("hasMore", action.hasMore),
    ...definedPatch("isFetching", action.isFetching),
    ...definedPatch("isFetchingNextPage", action.isFetchingNextPage),
    ...definedPatch("error", action.error),
  });
}

function reducePanelThreadSlice(state: ChatPanelThreadState, action: ChatSliceAction): ChatPanelThreadState {
  if (state.kind !== "active") return state;
  switch (action.type) {
    case "active-thread/token-usage-set":
      return patchObject(state, { thread: patchObject(state.thread, { tokenUsage: action.tokenUsage }) });
    default:
      return state;
  }
}

function reduceRuntimeSlice(state: ChatRuntimeState, action: ChatSliceAction): ChatRuntimeState {
  switch (action.type) {
    case "runtime/model-requested":
      return patchObject(state, requestModelRuntimeState(state, action.model));
    case "runtime/model-reset-to-config":
      return patchObject(state, resetModelToConfigRuntimeState(state));
    case "runtime/reasoning-effort-requested":
      return patchObject(state, requestReasoningEffortRuntimeState(state, action.effort));
    case "runtime/reasoning-effort-reset-to-config":
      return patchObject(state, resetReasoningEffortToConfigRuntimeState(state));
    case "runtime/permission-profile-requested":
      return patchObject(state, requestPermissionProfileRuntimeState(state, action.permissionProfile));
    case "runtime/permission-profile-reset-to-config":
      return patchObject(state, resetPermissionProfileToConfigRuntimeState(state));
    case "runtime/fast-mode-requested":
      return patchObject(state, requestFastModeRuntimeState(state, action.fastMode));
    case "runtime/fast-mode-request-cleared":
      return patchObject(state, clearRequestedFastModeRuntimeState(state));
    case "runtime/approvals-reviewer-requested":
      return patchObject(state, requestApprovalsReviewerRuntimeState(state, action.approvalsReviewer));
    case "runtime/approvals-reviewer-request-cleared":
      return patchObject(state, clearRequestedApprovalsReviewerRuntimeState(state));
    case "runtime/requested-collaboration-mode-set":
      return patchObject(state, setSelectedCollaborationModeRuntimeState(state, action.collaborationMode));
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, commitAppliedRuntimeSettingsPatchState(state, action.update));
    default:
      return state;
  }
}

function reduceComposerSlice(state: ChatComposerState, action: ChatSliceAction): ChatComposerState {
  switch (action.type) {
    case "composer/attachment-save-started":
      return patchObject(state, {
        draft: action.draft,
        pendingAttachmentSaveIds: [...state.pendingAttachmentSaveIds, action.saveId],
        suggestions: [],
        suggestSelected: 0,
      });
    case "composer/attachment-save-settled":
      return patchObject(state, {
        ...(action.draft === undefined ? {} : { draft: action.draft }),
        pendingAttachmentSaveIds: state.pendingAttachmentSaveIds.filter((saveId) => saveId !== action.saveId),
      });
    case "composer/draft-set":
      return patchObject(state, {
        draft: action.draft,
        ...(action.clearSuggestions ? { suggestions: [], suggestSelected: 0 } : {}),
        ...(action.resetDismissedSignature ? { suggestionsDismissedSignature: null } : {}),
      });
    case "composer/input-set":
      return setComposerSuggestionsSlice(
        patchObject(state, {
          draft: action.draft,
          suggestionsDismissedSignature: action.dismissedSignature ?? null,
        }),
        action.suggestions,
        action.selected ?? state.suggestSelected,
        action.dismissedSignature ?? null,
      );
    case "composer/suggestions-set":
      return setComposerSuggestionsSlice(
        state,
        action.suggestions,
        action.selected ?? state.suggestSelected,
        action.dismissedSignature === undefined ? state.suggestionsDismissedSignature : action.dismissedSignature,
      );
    default:
      return state;
  }
}

function initialConnectionState(): ChatConnectionState {
  return {
    phase: { kind: "idle" },
    statusText: "Idle",
    runtimeConfig: null,
    initializeResponse: null,
    serverDiagnostics: createServerDiagnostics(),
    rateLimit: null,
    availableModels: [],
    availableSkills: [],
    availablePermissionProfiles: [],
  };
}

function initialThreadListState(): ChatThreadListState {
  return { listedThreads: [], hasMore: false, isFetching: false, isFetchingNextPage: false, error: null };
}

function initialPanelThreadState(): ChatPanelThreadState {
  return { kind: "empty" };
}

function createAwaitingResumeThreadState(
  threadId: string,
  fallbackTitle: string | null,
  provenance: Thread["provenance"] | null = null,
): ChatPanelThreadState {
  return {
    kind: "awaiting-resume",
    threadId,
    fallbackTitle,
    provenance,
  };
}

function createActiveThreadState(id: string): ChatActiveThreadState {
  return {
    id,
    title: null,
    goal: null,
    tokenUsage: null,
    lifetime: null,
    canAcceptDirectInput: null,
    provenance: null,
  };
}

function initialTurnState(): ChatTurnState {
  return initialChatTurnState();
}

function initialThreadStreamState(items: readonly ThreadStreamItem[] = []): ChatThreadStreamState {
  return initialChatThreadStreamState(items);
}

function initialRequestState(): ChatRequestState {
  return initialChatRequestState();
}

function initialComposerState(): ChatComposerState {
  return {
    draft: "",
    pendingAttachmentSaveIds: [],
    suggestSelected: 0,
    suggestions: [],
    suggestionsDismissedSignature: null,
  };
}

function setComposerSuggestionsSlice(
  state: ChatComposerState,
  suggestions: readonly ComposerSuggestion[],
  selected: number,
  dismissedSignature: string | null,
): ChatComposerState {
  if (
    state.suggestSelected === selected &&
    state.suggestionsDismissedSignature === dismissedSignature &&
    state.suggestions === suggestions
  ) {
    return state;
  }
  return patchObject(state, {
    suggestions,
    suggestSelected: selected,
    suggestionsDismissedSignature: dismissedSignature,
  });
}

function patchChatState(state: ChatState, patch: Partial<ChatState>): ChatState {
  return patchObject(state, patch);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer Key, infer Value>
    ? ReadonlyMap<DeepReadonly<Key>, DeepReadonly<Value>>
    : T extends ReadonlySet<infer Value>
      ? ReadonlySet<DeepReadonly<Value>>
      : T extends readonly (infer Value)[]
        ? readonly DeepReadonly<Value>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T;
