import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { Thread } from "../../../../domain/threads/model";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { Diagnostics } from "../../../../domain/server/diagnostics";
import { createServerDiagnostics } from "../../../../domain/server/diagnostics";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ApprovalsReviewer } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { CollaborationMode } from "../../domain/runtime/pending-settings";
import {
  commitPendingRuntimeSettingsPatchState,
  clearRequestedApprovalsReviewerRuntimeState,
  clearRequestedServiceTierRuntimeState,
  initialActiveChatRuntimeState,
  initialChatRuntimeState,
  requestApprovalsReviewerRuntimeState,
  requestModelRuntimeState,
  requestReasoningEffortRuntimeState,
  requestServiceTierRuntimeState,
  resetModelToConfigRuntimeState,
  resetReasoningEffortToConfigRuntimeState,
  setSelectedCollaborationModeRuntimeState,
  type ChatRuntimeState,
} from "../../domain/runtime/state";
import type { RequestedServiceTier } from "../../domain/runtime/pending-settings";
import type { PendingRequestId } from "../../domain/pending-requests/model";
import type { ComposerSuggestion } from "../composer/suggestions";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type {
  ActiveThreadResumedAction,
  ActiveThreadRestoredPlaceholderAction,
  ActiveThreadSettingsAppliedAction,
  ClearActiveThreadAction,
  ClearDisconnectedConnectionStateAction,
  ClearLocalTurnAction,
  ConnectionInitializedAction,
  DisclosureSetAction,
  ThreadListAppliedAction,
  MessageStreamItemAddedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartFailedAction,
  UserInputDraftSetAction,
} from "./actions";
import {
  initialChatMessageStreamState,
  messageStreamItems,
  messageStreamStartActiveSegment,
  messageStreamWithActiveTurnItems,
  messageStreamWithItems,
  reduceMessageStreamSlice,
  type ChatMessageStreamActiveSegment,
  type ChatMessageStreamState,
  type MessageStreamAction,
} from "./message-stream";
import {
  initialChatRequestState,
  reduceRequestSlice,
  resolveChatRequest,
  type ChatRequestState,
  type RequestAction,
} from "../pending-requests/state";
import {
  initialChatTurnState,
  transitionChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "../conversation/turn-state";
import { STATUS_TURN_RUNNING, turnCompletedStatus } from "../conversation/messages";

export {
  activeTurnId,
  chatTurnBusy,
  pendingTurnStart,
  transitionChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "../conversation/turn-state";
export type { ChatMessageStreamState } from "./message-stream";

export type ChatConnectionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string }
  | { kind: "disconnected"; message: string };

interface ChatConnectionState {
  phase: ChatConnectionPhase;
  statusText: string;
  runtimeConfig: RuntimeConfigSnapshot | null;
  initializeResponse: ServerInitialization | null;
  rateLimit: RateLimitSnapshot | null;
  serverDiagnostics: Diagnostics;
  availableModels: readonly ModelMetadata[];
  availableSkills: readonly SkillMetadata[];
}

interface ChatThreadListState {
  listedThreads: readonly Thread[];
  threadsLoaded: boolean;
}

export interface ChatActiveThreadState {
  id: string | null;
  cwd: string | null;
  goal: ThreadGoal | null;
  tokenUsage: ThreadTokenUsage | null;
}

export type { ChatRuntimeState } from "../../domain/runtime/state";

interface ChatComposerState {
  draft: string;
  suggestSelected: number;
  suggestions: readonly ComposerSuggestion[];
  suggestionsDismissedSignature: string | null;
}

export type ChatRenameUiState =
  | { kind: "idle" }
  | { kind: "editing"; threadId: string; draft: string }
  | { kind: "generating"; threadId: string; draft: string; originalDraft: string; generationId: number };

export type ChatRenameGeneratingUiState = Extract<ChatRenameUiState, { kind: "generating" }>;

type ChatGoalEditorUiState =
  | { kind: "closed" }
  | { kind: "editing"; threadId: string | null; objectiveDraft: string; tokenBudgetDraft: number | null };

interface ChatMessageActionsUiState {
  forkActionsItemId: string | null;
}

export type ChatDisclosureBucket =
  | "toolResults"
  | "activityGroups"
  | "agentDetails"
  | "textDetails"
  | "userMessageExpanded"
  | "goalObjectiveExpanded"
  | "approvalDetails";

export interface ChatDisclosureUiState {
  toolResults: ReadonlySet<string>;
  activityGroups: ReadonlySet<string>;
  agentDetails: ReadonlySet<string>;
  textDetails: ReadonlySet<string>;
  userMessageExpanded: ReadonlySet<string>;
  goalObjectiveExpanded: ReadonlySet<string>;
  approvalDetails: ReadonlySet<string>;
}

interface ChatUiState {
  toolbarPanel: "history" | "chat-actions" | "status-panel" | null;
  archiveConfirmThreadId: string | null;
  rename: ChatRenameUiState;
  goalEditor: ChatGoalEditorUiState;
  messageActions: ChatMessageActionsUiState;
  disclosures: ChatDisclosureUiState;
}

export interface ChatState {
  connection: ChatConnectionState;
  threadList: ChatThreadListState;
  activeThread: ChatActiveThreadState;
  runtime: ChatRuntimeState;
  turn: ChatTurnState;
  messageStream: ChatMessageStreamState;
  requests: ChatRequestState;
  composer: ChatComposerState;
  ui: ChatUiState;
}

export interface ChatStateStore {
  getState(): ChatState;
  dispatch(action: ChatAction): ChatState;
  subscribe(listener: () => void): () => void;
}

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | ConnectionInitializedAction
  | {
      type: "connection/metadata-applied";
      runtimeConfig?: RuntimeConfigSnapshot | null;
      availableModels?: readonly ModelMetadata[];
      availableSkills?: readonly SkillMetadata[];
      rateLimit?: RateLimitSnapshot | null;
      serverDiagnostics?: Diagnostics;
    };

type ThreadListAction = ThreadListAppliedAction;

type ActiveThreadAction =
  | { type: "active-thread/cwd-set"; cwd: string | null }
  | { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/model-requested"; model: string }
  | { type: "runtime/model-reset-to-config" }
  | { type: "runtime/reasoning-effort-requested"; effort: ReasoningEffort }
  | { type: "runtime/reasoning-effort-reset-to-config" }
  | { type: "runtime/service-tier-requested"; serviceTier: RequestedServiceTier }
  | { type: "runtime/service-tier-request-cleared" }
  | { type: "runtime/approvals-reviewer-requested"; approvalsReviewer: ApprovalsReviewer }
  | { type: "runtime/approvals-reviewer-request-cleared" }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: CollaborationMode }
  | { type: "runtime/pending-thread-settings-committed"; update: RuntimeSettingsPatch };

interface TurnStartedAction {
  type: "turn/started";
  threadId: string;
  turnId: string;
  items?: readonly MessageStreamItem[];
}

interface TurnCompletedAction {
  type: "turn/completed";
  turnId: string;
  status: string;
  items: readonly MessageStreamItem[];
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

type UiAction =
  | {
      type: "ui/panel-set";
      panel: "history" | "chat-actions" | "status-panel" | null;
      toggle?: boolean;
    }
  | { type: "ui/archive-confirm-set"; threadId: string | null }
  | { type: "ui/rename-started"; threadId: string; draft: string }
  | { type: "ui/rename-draft-updated"; threadId: string; draft: string }
  | { type: "ui/rename-cancelled"; threadId: string }
  | { type: "ui/rename-generation-started"; threadId: string; originalDraft: string; generationId: number }
  | { type: "ui/rename-generation-succeeded"; generatingState: ChatRenameGeneratingUiState; draft: string }
  | { type: "ui/rename-generation-finished"; threadId: string; generatingState: ChatRenameGeneratingUiState }
  | { type: "ui/rename-cleared" }
  | { type: "ui/goal-editor-started"; threadId: string | null; objective: string; tokenBudget: number | null }
  | { type: "ui/goal-editor-draft-updated"; objective: string }
  | { type: "ui/goal-editor-closed" }
  | { type: "ui/message-fork-actions-set"; itemId: string | null }
  | DisclosureSetAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

interface RequestResolvedAction {
  type: "request/resolved";
  requestId: PendingRequestId;
  resultItem?: MessageStreamItem;
}

interface PendingStartHookUpsertedAction {
  type: "turn/pending-start-hook-upserted";
  item: MessageStreamItem;
  pendingTurnStart: PendingTurnStart | null;
}

type ChatTransitionAction =
  | ClearDisconnectedConnectionStateAction
  | ClearActiveThreadAction
  | ActiveThreadResumedAction
  | ActiveThreadSettingsAppliedAction
  | ActiveThreadRestoredPlaceholderAction
  | { type: "active-thread/goal-set"; goal: ThreadGoal | null }
  | TurnAction
  | RequestResolvedAction
  | PendingStartHookUpsertedAction;

type ChatSliceAction =
  | ConnectionAction
  | ThreadListAction
  | ActiveThreadAction
  | RuntimeAction
  | RequestAction
  | UserInputDraftSetAction
  | MessageStreamAction
  | MessageStreamItemAddedAction
  | ComposerAction
  | UiAction;

export function createChatState(): ChatState {
  return {
    connection: initialConnectionState(),
    threadList: initialThreadListState(),
    activeThread: initialActiveThreadState(),
    runtime: initialRuntimeState(),
    turn: initialTurnState(),
    messageStream: initialMessageStreamState(),
    requests: initialRequestState(),
    composer: initialComposerState(),
    ui: initialUiState(),
  };
}

export function createChatStateStore(initialState: ChatState = createChatState()): ChatStateStore {
  let current = cloneChatState(initialState);
  const listeners = new Set<() => void>();
  return {
    getState: () => current,
    dispatch(action) {
      const next = chatReducer(current, action);
      if (next === current) return current;
      current = next;
      for (const listener of listeners) listener();
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
    case "active-thread/cleared":
    case "active-thread/resumed":
    case "active-thread/settings-applied":
    case "active-thread/restored-placeholder":
    case "active-thread/goal-set":
    case "turn/started":
    case "turn/completed":
    case "turn/scoped-cleared":
    case "turn/optimistic-started":
    case "turn/start-acknowledged":
    case "turn/start-failed":
    case "turn/pending-start-hook-upserted":
    case "request/resolved":
      return reduceChatTransition(state, action);
    default:
      return reduceChatSlices(state, action);
  }
}

function reduceChatTransition(state: ChatState, action: ChatTransitionAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
      return reduceDisconnectedConnectionStateClearedTransition(state);
    case "active-thread/cleared":
      return reduceActiveThreadClearedTransition(state);
    case "active-thread/resumed":
      return reduceActiveThreadResumedTransition(state, action);
    case "active-thread/settings-applied":
      return reduceActiveThreadSettingsAppliedTransition(state, action);
    case "active-thread/restored-placeholder":
      return reduceActiveThreadRestoredPlaceholderTransition(state, action);
    case "active-thread/goal-set":
      return reduceActiveThreadGoalSetTransition(state, action.goal);
    case "turn/started":
      return reduceTurnStartedTransition(state, action);
    case "turn/completed":
      return reduceTurnCompletedTransition(state, action);
    case "turn/scoped-cleared":
      return reduceTurnScopedClearedTransition(state);
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
  }
}

function reduceDisconnectedConnectionStateClearedTransition(state: ChatState): ChatState {
  return clearDisconnectedConnectionState(state);
}

function reduceActiveThreadClearedTransition(state: ChatState): ChatState {
  return clearActiveThreadState(state);
}

function reduceActiveThreadResumedTransition(state: ChatState, action: ActiveThreadResumedAction): ChatState {
  const runtimeBase = action.preserveRequestedRuntimeSettings ? state.runtime : initialChatRuntimeState();
  return patchChatState(clearActiveTurnState(state), {
    connection: {
      ...state.connection,
      statusText: action.status ?? state.connection.statusText,
    },
    threadList: {
      ...state.threadList,
      listedThreads: action.listedThreads ?? state.threadList.listedThreads,
    },
    activeThread: {
      id: action.thread.id,
      cwd: action.cwd,
      goal: null,
      tokenUsage: null,
    },
    runtime: {
      ...runtimeBase,
      activeModel: action.model,
      activeReasoningEffort: action.reasoningEffort,
      activeCollaborationMode: initialActiveChatRuntimeState().activeCollaborationMode,
      activeServiceTier: action.serviceTier,
      activeApprovalPolicy: action.approvalPolicy,
      activeApprovalsReviewer: action.approvalsReviewer,
      activePermissionProfile: action.activePermissionProfile,
    },
    turn: initialTurnState(),
    messageStream: initialMessageStreamState(action.items ?? []),
    requests: initialRequestState(),
    composer: initialComposerState(),
    ui: initialUiState(),
  });
}

function reduceActiveThreadSettingsAppliedTransition(state: ChatState, action: ActiveThreadSettingsAppliedAction): ChatState {
  return patchChatState(state, {
    activeThread: {
      ...state.activeThread,
      cwd: action.cwd,
    },
    runtime: {
      ...state.runtime,
      activeModel: action.model,
      activeReasoningEffort: action.reasoningEffort,
      activeCollaborationMode: action.collaborationMode,
      selectedCollaborationMode: action.collaborationMode,
      activeServiceTier: action.serviceTier,
      activeApprovalPolicy: action.approvalPolicy,
      activeApprovalsReviewer: action.approvalsReviewer,
      activePermissionProfile: action.activePermissionProfile,
    },
  });
}

function reduceActiveThreadRestoredPlaceholderTransition(state: ChatState, action: ActiveThreadRestoredPlaceholderAction): ChatState {
  return clearActiveTurnState(
    patchChatState(state, {
      activeThread: {
        id: action.threadId,
        cwd: null,
        goal: null,
        tokenUsage: null,
      },
      runtime: initialChatRuntimeState(),
      messageStream: initialMessageStreamState(),
      ui: initialUiState(),
    }),
  );
}

function reduceActiveThreadGoalSetTransition(state: ChatState, goal: ThreadGoal | null): ChatState {
  return patchChatState(state, {
    activeThread: {
      ...state.activeThread,
      goal,
    },
    ui: maybeClearGoalObjectiveExpansion(state.ui, state.activeThread.goal, goal),
  });
}

function reduceTurnStartedTransition(state: ChatState, action: TurnStartedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "started", turnId: action.turnId });
  return patchChatState(state, {
    activeThread: { ...state.activeThread, id: action.threadId },
    turn: { lifecycle },
    connection: { ...state.connection, statusText: STATUS_TURN_RUNNING },
    messageStream: action.items
      ? messageStreamWithActiveTurnItems(state.messageStream, action.turnId, action.items)
      : messageStreamStartActiveSegment(state.messageStream, action.turnId, []),
  });
}

function reduceTurnCompletedTransition(state: ChatState, action: TurnCompletedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "completed", turnId: action.turnId });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    messageStream: messageStreamWithItems(state.messageStream, action.items),
    connection: { ...state.connection, statusText: turnCompletedStatus(action.status) },
  });
}

function reduceTurnScopedClearedTransition(state: ChatState): ChatState {
  return clearActiveTurnState(state);
}

function reduceTurnOptimisticStartedTransition(state: ChatState, action: TurnOptimisticStartedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, {
    type: "optimistic-started",
    pendingTurnStart: action.pendingTurnStart,
  });
  return patchChatState(state, {
    turn: { lifecycle },
    messageStream: messageStreamStartActiveSegment(state.messageStream, null, [action.item]),
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
    messageStream: messageStreamWithActiveTurnItems(state.messageStream, action.turnId, action.items),
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "start-failed" });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    messageStream: messageStreamWithItems(state.messageStream, action.items),
  });
}

function reducePendingStartHookUpsertedTransition(state: ChatState, action: PendingStartHookUpsertedAction): ChatState {
  return patchChatState(state, {
    messageStream: reduceMessageStreamSlice(state.messageStream, { type: "message-stream/item-upserted", item: action.item }),
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
    messageStream: action.resultItem
      ? reduceMessageStreamSlice(state.messageStream, { type: "message-stream/item-added", item: action.resultItem })
      : state.messageStream,
  });
}

function reduceChatSlices(state: ChatState, action: ChatSliceAction): ChatState {
  return patchChatState(state, {
    connection: reduceConnectionSlice(state.connection, action),
    threadList: reduceThreadListSlice(state.threadList, action),
    activeThread: reduceActiveThreadSlice(state.activeThread, action),
    runtime: reduceRuntimeSlice(state.runtime, action),
    turn: state.turn,
    requests: isRequestAction(action) ? reduceRequestSlice(state.requests, action) : state.requests,
    messageStream: isMessageStreamAction(action) ? reduceMessageStreamSlice(state.messageStream, action) : state.messageStream,
    composer: reduceComposerSlice(state.composer, action),
    ui: reduceUiSlice(state.ui, action),
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
    ...definedPatch("listedThreads", action.threads),
    ...definedPatch("threadsLoaded", action.threadsLoaded),
  });
}

function reduceActiveThreadSlice(state: ChatActiveThreadState, action: ChatSliceAction): ChatActiveThreadState {
  switch (action.type) {
    case "active-thread/cwd-set":
      return patchObject(state, { cwd: action.cwd });
    case "active-thread/token-usage-set":
      return patchObject(state, { tokenUsage: action.tokenUsage });
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
    case "runtime/service-tier-requested":
      return patchObject(state, requestServiceTierRuntimeState(state, action.serviceTier));
    case "runtime/service-tier-request-cleared":
      return patchObject(state, clearRequestedServiceTierRuntimeState(state));
    case "runtime/approvals-reviewer-requested":
      return patchObject(state, requestApprovalsReviewerRuntimeState(state, action.approvalsReviewer));
    case "runtime/approvals-reviewer-request-cleared":
      return patchObject(state, clearRequestedApprovalsReviewerRuntimeState(state));
    case "runtime/requested-collaboration-mode-set":
      return patchObject(state, setSelectedCollaborationModeRuntimeState(state, action.collaborationMode));
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, commitPendingRuntimeSettingsPatchState(state, action.update));
    default:
      return state;
  }
}

function reduceComposerSlice(state: ChatComposerState, action: ChatSliceAction): ChatComposerState {
  switch (action.type) {
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

function reduceUiSlice(state: ChatUiState, action: ChatSliceAction): ChatUiState {
  switch (action.type) {
    case "ui/panel-set":
      return setPanelSlice(state, action.panel, action.toggle ?? false);
    case "ui/archive-confirm-set":
      return patchObject(state, { archiveConfirmThreadId: action.threadId });
    case "ui/rename-started":
      return patchObject(state, { rename: { kind: "editing", threadId: action.threadId, draft: action.draft } });
    case "ui/rename-draft-updated":
      return patchObject(state, { rename: renameUiStateUpdated(state.rename, action.threadId, action.draft) });
    case "ui/rename-cancelled":
      return patchObject(state, { rename: renameUiStateCancelled(state.rename, action.threadId) });
    case "ui/rename-generation-started":
      return patchObject(state, {
        rename: renameUiGenerationStarted(state.rename, action.threadId, action.originalDraft, action.generationId),
      });
    case "ui/rename-generation-succeeded":
      return patchObject(state, { rename: renameUiGenerationSucceeded(state.rename, action.generatingState, action.draft) });
    case "ui/rename-generation-finished":
      return patchObject(state, { rename: renameUiGenerationFinished(state.rename, action.threadId, action.generatingState) });
    case "ui/rename-cleared":
      return patchObject(state, { rename: initialRenameUiState() });
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
    case "ui/message-fork-actions-set":
      return patchObject(state, { messageActions: { forkActionsItemId: action.itemId } });
    case "ui/disclosure-set":
      return setDisclosureSlice(state, action.bucket, action.id, action.open);
    default:
      return state;
  }
}

function clearActiveTurnState(state: ChatState): ChatState {
  return patchChatState(state, {
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "cleared" }),
    },
    messageStream: messageStreamWithItems(state.messageStream, messageStreamItems(state.messageStream)),
    requests: initialRequestState(),
    ui: clearAllRequestDisclosures(state.ui),
  });
}

function clearActiveThreadState(state: ChatState): ChatState {
  return clearActiveTurnState(
    patchChatState(state, {
      activeThread: initialActiveThreadState(),
      runtime: initialChatRuntimeState(),
      messageStream: initialMessageStreamState(),
      composer: initialComposerState(),
      ui: initialUiState(),
    }),
  );
}

function clearDisconnectedConnectionState(state: ChatState): ChatState {
  return patchChatState(clearActiveTurnState(state), {
    activeThread: initialActiveThreadState(),
    runtime: initialChatRuntimeState(),
    connection: {
      ...state.connection,
      serverDiagnostics: createServerDiagnostics(),
      rateLimit: null,
      availableModels: [],
      availableSkills: [],
    },
    threadList: initialThreadListState(),
  });
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
  };
}

function initialThreadListState(): ChatThreadListState {
  return {
    listedThreads: [],
    threadsLoaded: false,
  };
}

function initialActiveThreadState(): ChatActiveThreadState {
  return {
    id: null,
    cwd: null,
    goal: null,
    tokenUsage: null,
  };
}

function initialRuntimeState(): ChatRuntimeState {
  return initialChatRuntimeState();
}

function initialTurnState(): ChatTurnState {
  return initialChatTurnState();
}

function initialMessageStreamState(items: readonly MessageStreamItem[] = []): ChatMessageStreamState {
  return initialChatMessageStreamState(items);
}

function initialRequestState(): ChatRequestState {
  return initialChatRequestState();
}

function initialComposerState(): ChatComposerState {
  return {
    draft: "",
    suggestSelected: 0,
    suggestions: [],
    suggestionsDismissedSignature: null,
  };
}

function initialUiState(): ChatUiState {
  return {
    toolbarPanel: null,
    archiveConfirmThreadId: null,
    rename: initialRenameUiState(),
    goalEditor: initialGoalEditorUiState(),
    messageActions: initialMessageActionsUiState(),
    disclosures: initialDisclosureUiState(),
  };
}

function cloneChatState(state: ChatState): ChatState {
  return {
    connection: {
      ...state.connection,
      availableModels: [...state.connection.availableModels],
      availableSkills: [...state.connection.availableSkills],
    },
    threadList: {
      listedThreads: [...state.threadList.listedThreads],
      threadsLoaded: state.threadList.threadsLoaded,
    },
    activeThread: { ...state.activeThread },
    runtime: { ...state.runtime },
    turn: { lifecycle: state.turn.lifecycle },
    messageStream: cloneMessageStreamState(state.messageStream),
    requests: {
      approvals: [...state.requests.approvals],
      pendingUserInputs: [...state.requests.pendingUserInputs],
      userInputDrafts: new Map(state.requests.userInputDrafts),
    },
    composer: {
      ...state.composer,
      suggestions: [...state.composer.suggestions],
    },
    ui: {
      toolbarPanel: state.ui.toolbarPanel,
      archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
      rename: { ...state.ui.rename },
      goalEditor: { ...state.ui.goalEditor },
      messageActions: { ...state.ui.messageActions },
      disclosures: cloneDisclosureUiState(state.ui.disclosures),
    },
  };
}

function cloneMessageStreamState(state: ChatMessageStreamState): ChatMessageStreamState {
  const next = initialChatMessageStreamState([...state.stableItems]);
  next.activeSegment = cloneActiveSegment(state.activeSegment);
  next.turnDiffs = new Map(state.turnDiffs);
  next.historyCursor = state.historyCursor;
  next.loadingHistory = state.loadingHistory;
  next.reportedLogs = new Set(state.reportedLogs);
  return next;
}

function cloneActiveSegment(segment: ChatMessageStreamActiveSegment | null): ChatMessageStreamActiveSegment | null {
  if (!segment) return null;
  return {
    turnId: segment.turnId,
    items: [...segment.items],
    indexById: new Map(segment.indexById),
    indexBySourceItemId: new Map(segment.indexBySourceItemId),
  };
}

function isMessageStreamAction(action: ChatSliceAction): action is MessageStreamAction {
  return action.type.startsWith("message-stream/");
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

function initialMessageActionsUiState(): ChatMessageActionsUiState {
  return { forkActionsItemId: null };
}

function initialDisclosureUiState(): ChatDisclosureUiState {
  return {
    toolResults: new Set(),
    activityGroups: new Set(),
    agentDetails: new Set(),
    textDetails: new Set(),
    userMessageExpanded: new Set(),
    goalObjectiveExpanded: new Set(),
    approvalDetails: new Set(),
  };
}

function cloneDisclosureUiState(state: ChatDisclosureUiState): ChatDisclosureUiState {
  return {
    toolResults: new Set(state.toolResults),
    activityGroups: new Set(state.activityGroups),
    agentDetails: new Set(state.agentDetails),
    textDetails: new Set(state.textDetails),
    userMessageExpanded: new Set(state.userMessageExpanded),
    goalObjectiveExpanded: new Set(state.goalObjectiveExpanded),
    approvalDetails: new Set(state.approvalDetails),
  };
}

function maybeClearGoalObjectiveExpansion(state: ChatUiState, currentGoal: ThreadGoal | null, nextGoal: ThreadGoal | null): ChatUiState {
  if (goalObjectiveResetKey(currentGoal) === goalObjectiveResetKey(nextGoal)) return state;
  if (state.disclosures.goalObjectiveExpanded.size === 0) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      goalObjectiveExpanded: new Set(),
    },
  });
}

function goalObjectiveResetKey(goal: ThreadGoal | null): string {
  if (!goal) return "";
  return [goal.threadId, goal.objective, goal.status, String(goal.tokenBudget ?? "")].join("\u0000");
}

function goalEditorDraftUpdated(state: ChatGoalEditorUiState, objective: string): ChatGoalEditorUiState {
  if (state.kind !== "editing") return state;
  return { ...state, objectiveDraft: objective };
}

function renameUiStateUpdated(state: ChatRenameUiState, threadId: string, draft: string): ChatRenameUiState {
  if (state.kind === "idle" || state.threadId !== threadId) return state;
  return { ...state, draft };
}

function renameUiStateCancelled(state: ChatRenameUiState, threadId: string): ChatRenameUiState {
  if (state.kind === "idle" || state.threadId !== threadId) return state;
  return initialRenameUiState();
}

function renameUiGenerationStarted(
  state: ChatRenameUiState,
  threadId: string,
  originalDraft: string,
  generationId: number,
): ChatRenameUiState {
  if (state.kind !== "editing" || state.threadId !== threadId) return state;
  return {
    kind: "generating",
    threadId,
    draft: state.draft,
    originalDraft,
    generationId,
  };
}

function renameUiGenerationSucceeded(
  state: ChatRenameUiState,
  generatingState: ChatRenameGeneratingUiState,
  draft: string,
): ChatRenameUiState {
  if (!renameGenerationStillActive(state, generatingState) || state.draft !== generatingState.originalDraft) return state;
  return { ...state, draft };
}

function renameUiGenerationFinished(
  state: ChatRenameUiState,
  threadId: string,
  generatingState: ChatRenameGeneratingUiState,
): ChatRenameUiState {
  if (!renameGenerationStillActive(state, generatingState) || state.threadId !== threadId) return state;
  return {
    kind: "editing",
    threadId: state.threadId,
    draft: state.draft,
  };
}

export function renameGenerationStillActive(
  state: ChatRenameUiState,
  generatingState: ChatRenameGeneratingUiState,
): state is ChatRenameGeneratingUiState {
  return (
    state.kind === "generating" &&
    state.threadId === generatingState.threadId &&
    state.originalDraft === generatingState.originalDraft &&
    state.generationId === generatingState.generationId
  );
}

function clearAllRequestDisclosures(state: ChatUiState): ChatUiState {
  if (state.disclosures.approvalDetails.size === 0) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      approvalDetails: new Set(),
    },
  });
}

function clearResolvedRequestDisclosures(state: ChatUiState, requestId: PendingRequestId): ChatUiState {
  const id = String(requestId);
  const approvalDetails = filterStringSet(state.disclosures.approvalDetails, (key) => !key.startsWith(`${id}:`));
  if (approvalDetails === state.disclosures.approvalDetails) return state;
  return patchObject(state, {
    disclosures: {
      ...state.disclosures,
      approvalDetails,
    },
  });
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

function isRequestAction(action: ChatSliceAction): action is RequestAction {
  return action.type.startsWith("request/");
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
    composerSuggestionsEqual(state.suggestions, suggestions)
  ) {
    return state;
  }
  return patchObject(state, {
    suggestions,
    suggestSelected: selected,
    suggestionsDismissedSignature: dismissedSignature,
  });
}

function composerSuggestionsEqual(left: readonly ComposerSuggestion[], right: readonly ComposerSuggestion[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      item.display === other?.display &&
      item.detail === other.detail &&
      item.replacement === other.replacement &&
      item.start === other.start &&
      item.appendSpaceOnInsert === other.appendSpaceOnInsert
    );
  });
}

function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  return { ...current, ...patch };
}

function patchChatState(state: ChatState, patch: Partial<ChatState>): ChatState {
  if (Object.entries(patch).every(([key, value]) => Object.is(state[key as keyof ChatState], value))) return state;
  return { ...state, ...patch };
}

function definedPatch<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
