import type { ServerInitialization } from "../../../domain/server/initialization";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { ModelMetadata, SkillMetadata } from "../../../domain/catalog/metadata";
import type { ThreadGoal } from "../../../domain/threads/goal";
import type { Diagnostics } from "../../../domain/server/diagnostics";
import { createServerDiagnostics } from "../../../domain/server/diagnostics";
import type { RuntimeConfigSnapshot } from "../../../domain/runtime/config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../../domain/runtime/metrics";
import type { ApprovalsReviewer } from "../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../domain/runtime/thread-settings";
import type { CollaborationMode } from "../runtime/pending-settings";
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
} from "../runtime/state";
import type { RequestedServiceTier } from "../runtime/pending-settings";
import type { RequestId } from "../../../app-server/connection/rpc-messages";
import type { ComposerSuggestion } from "../conversation/composer/suggestions";
import type { DisplayItem } from "../display/types";
import type {
  ActiveThreadResumedAction,
  ActiveThreadRestoredPlaceholderAction,
  ActiveThreadSettingsAppliedAction,
  ClearActiveThreadAction,
  ClearDisconnectedConnectionStateAction,
  ClearLocalTurnAction,
  ConnectionInitializedAction,
  DetailOpenSetAction,
  ThreadListAppliedAction,
  MessageStreamItemAddedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartFailedAction,
  UserInputDraftSetAction,
} from "./actions";
import {
  initialChatMessageStreamState,
  messageStreamDisplayItems,
  messageStreamStartActiveSegment,
  messageStreamWithActiveTurnItems,
  messageStreamWithDisplayItems,
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
} from "../conversation/pending-requests/state";
import {
  initialChatTurnState,
  transitionChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "../conversation/turns/turn-state";

export {
  activeTurnId,
  chatTurnBusy,
  pendingTurnStart,
  transitionChatTurnLifecycleState,
  type ChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "../conversation/turns/turn-state";
export type { ChatMessageStreamState } from "./message-stream";

interface ChatConnectionState {
  status: string;
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

export type { ChatRuntimeState } from "../runtime/state";

interface ChatComposerState {
  draft: string;
  suggestSelected: number;
  suggestions: readonly ComposerSuggestion[];
  suggestionsDismissedSignature: string | null;
}

interface ChatUiState {
  openDetails: ReadonlySet<string>;
  toolbarPanel: "history" | "chat-actions" | "status-panel" | null;
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
  | { type: "connection/status-set"; status: string }
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
  | { type: "active-thread/goal-set"; goal: ThreadGoal | null }
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
  displayItems?: readonly DisplayItem[];
}

interface TurnCompletedAction {
  type: "turn/completed";
  turnId: string;
  status: string;
  displayItems: readonly DisplayItem[];
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
  | DetailOpenSetAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

interface RequestResolvedAction {
  type: "request/resolved";
  requestId: RequestId;
  resultItem?: DisplayItem;
}

interface PendingStartHookUpsertedAction {
  type: "turn/pending-start-hook-upserted";
  item: DisplayItem;
  pendingTurnStart: PendingTurnStart | null;
}

type ChatTransitionAction =
  | ClearDisconnectedConnectionStateAction
  | ClearActiveThreadAction
  | ActiveThreadResumedAction
  | ActiveThreadSettingsAppliedAction
  | ActiveThreadRestoredPlaceholderAction
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
  return patchChatState(clearActiveTurnState(state), {
    connection: {
      ...state.connection,
      status: action.status ?? state.connection.status,
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
      ...state.runtime,
      activeModel: action.model,
      activeReasoningEffort: action.reasoningEffort,
      activeCollaborationMode: initialActiveChatRuntimeState().activeCollaborationMode,
      activeServiceTier: action.serviceTier,
      activeApprovalPolicy: action.approvalPolicy,
      activeApprovalsReviewer: action.approvalsReviewer,
      activePermissionProfile: action.activePermissionProfile,
    },
    turn: initialTurnState(),
    messageStream: initialMessageStreamState(action.displayItems ?? []),
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
      runtime: {
        ...state.runtime,
        ...initialActiveChatRuntimeState(),
      },
      messageStream: initialMessageStreamState(),
      ui: initialUiState(),
    }),
  );
}

function reduceTurnStartedTransition(state: ChatState, action: TurnStartedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "started", turnId: action.turnId });
  return patchChatState(state, {
    activeThread: { ...state.activeThread, id: action.threadId },
    turn: { lifecycle },
    connection: { ...state.connection, status: "Turn running..." },
    messageStream: action.displayItems
      ? messageStreamWithActiveTurnItems(state.messageStream, action.turnId, action.displayItems)
      : messageStreamStartActiveSegment(state.messageStream, action.turnId, []),
  });
}

function reduceTurnCompletedTransition(state: ChatState, action: TurnCompletedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "completed", turnId: action.turnId });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    messageStream: messageStreamWithDisplayItems(state.messageStream, action.displayItems),
    connection: { ...state.connection, status: `Turn ${action.status}.` },
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
    messageStream: messageStreamWithActiveTurnItems(state.messageStream, action.turnId, action.displayItems),
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "start-failed" });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    messageStream: messageStreamWithDisplayItems(state.messageStream, action.displayItems),
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
    ui: clearResolvedRequestDetailOpenState(state.ui, action.requestId),
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
      return patchObject(state, { status: action.status });
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
    case "active-thread/goal-set":
      return patchObject(state, { goal: action.goal });
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
    case "ui/detail-open-set":
      return setDetailOpenSlice(state, action.key, action.open);
    default:
      return state;
  }
}

function clearActiveTurnState(state: ChatState): ChatState {
  return patchChatState(state, {
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "cleared" }),
    },
    messageStream: messageStreamWithDisplayItems(state.messageStream, messageStreamDisplayItems(state.messageStream)),
    requests: initialRequestState(),
    ui: clearAllRequestDetailOpenState(state.ui),
  });
}

function clearActiveThreadState(state: ChatState): ChatState {
  return clearActiveTurnState(
    patchChatState(state, {
      activeThread: initialActiveThreadState(),
      runtime: {
        ...state.runtime,
        ...initialActiveChatRuntimeState(),
      },
      messageStream: initialMessageStreamState(),
      composer: initialComposerState(),
      ui: initialUiState(),
    }),
  );
}

function clearDisconnectedConnectionState(state: ChatState): ChatState {
  return patchChatState(clearActiveTurnState(state), {
    activeThread: initialActiveThreadState(),
    runtime: {
      ...state.runtime,
      ...initialActiveChatRuntimeState(),
    },
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
    status: "Idle",
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

function initialMessageStreamState(items: readonly DisplayItem[] = []): ChatMessageStreamState {
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
    openDetails: new Set(),
    toolbarPanel: null,
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
      openDetails: new Set(state.ui.openDetails),
      toolbarPanel: state.ui.toolbarPanel,
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

function setDetailOpenSlice(state: ChatUiState, key: string, open: boolean): ChatUiState {
  if (state.openDetails.has(key) === open) return state;
  const openDetails = new Set(state.openDetails);
  if (open) {
    openDetails.add(key);
  } else {
    openDetails.delete(key);
  }
  return patchObject(state, { openDetails });
}

function clearAllRequestDetailOpenState(state: ChatUiState): ChatUiState {
  return filterOpenDetails(state, (key) => !isRequestDetailOpenKey(key));
}

function clearResolvedRequestDetailOpenState(state: ChatUiState, requestId: RequestId): ChatUiState {
  return filterOpenDetails(state, (key) => !isRequestDetailOpenKeyForRequest(key, requestId));
}

function filterOpenDetails(state: ChatUiState, keep: (key: string) => boolean): ChatUiState {
  let openDetails: Set<string> | null = null;
  for (const key of state.openDetails) {
    if (keep(key)) {
      openDetails?.add(key);
    } else if (openDetails === null) {
      openDetails = new Set();
      for (const kept of state.openDetails) {
        if (kept === key) break;
        openDetails.add(kept);
      }
    }
  }
  return openDetails === null ? state : patchObject(state, { openDetails });
}

function isRequestDetailOpenKey(key: string): boolean {
  return key.startsWith("approval:") || key.startsWith("request:");
}

function isRequestDetailOpenKeyForRequest(key: string, requestId: RequestId): boolean {
  const id = String(requestId);
  return key === `request:${id}` || key.startsWith(`request:${id}:`) || key.startsWith(`approval:${id}:`);
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
