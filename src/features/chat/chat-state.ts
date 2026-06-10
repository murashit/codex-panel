import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import type { ThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadSettingsUpdate } from "../../app-server/thread-settings";
import type { Diagnostics } from "../../app-server/diagnostics";
import { createAppServerDiagnostics } from "../../app-server/diagnostics";
import type { RuntimeConfigSnapshot } from "../../app-server/runtime-config";
import type { RateLimitSnapshot, ThreadTokenUsage } from "../../app-server/runtime-metrics";
import type { ApprovalsReviewer } from "./runtime/approvals";
import type { CollaborationMode } from "./runtime/collaboration";
import type { RequestedServiceTier } from "./runtime/service-tier-state";
import {
  commitPendingThreadSettingsRuntimeState,
  initialActiveChatRuntimeState,
  initialChatRuntimeState,
  setRequestedApprovalsReviewerRuntimeState,
  setRequestedModelRuntimeState,
  setRequestedReasoningEffortRuntimeState,
  setRequestedServiceTierRuntimeState,
  setSelectedCollaborationModeRuntimeState,
  type ChatRuntimeState,
} from "./runtime/state";
import type { PendingApproval } from "./requests/approval";
import type { ComposerSuggestion } from "./composer/suggestions";
import { upsertDisplayItem } from "./display/stream-updates";
import type { DisplayItem } from "./display/types";
import type {
  ActiveThreadResumedAction,
  ActiveThreadRestoredPlaceholderAction,
  ActiveThreadSettingsAppliedAction,
  ActiveThreadTokenUsageSetAction,
  ClearActiveThreadAction,
  ClearDisconnectedConnectionStateAction,
  ClearLocalTurnAction,
  ClosePanelsAction,
  ConnectionInitializedAction,
  DetailOpenSetAction,
  SetRequestedCollaborationModeDefaultAction,
  ThreadListAppliedAction,
  TranscriptItemAddedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartFailedAction,
  UserInputDraftSetAction,
} from "./chat-state-actions";
import { initialChatTranscriptState, reduceTranscriptSlice, type ChatTranscriptState, type TranscriptAction } from "./transcript-state";
import {
  initialChatRequestState,
  reduceRequestSlice,
  resolveChatRequest,
  type ChatRequestState,
  type RequestAction,
} from "./requests/request-state";
import { initialChatTurnState, transitionChatTurnLifecycleState, type ChatTurnState, type PendingTurnStart } from "./turns/turn-state";

export {
  activeTurnId,
  chatTurnBusy,
  pendingTurnStart,
  transitionChatTurnLifecycleState,
  type ChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "./turns/turn-state";
export type { ChatTranscriptState } from "./transcript-state";

interface ChatConnectionState {
  status: string;
  runtimeConfig: RuntimeConfigSnapshot | null;
  initializeResponse: InitializeResponse | null;
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: Diagnostics;
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

export type { ChatRuntimeState } from "./runtime/state";

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
  transcript: ChatTranscriptState;
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
      appServerDiagnostics?: Diagnostics;
    };

type ThreadListAction = ThreadListAppliedAction;

type ActiveThreadAction =
  | { type: "active-thread/cwd-set"; cwd: string | null }
  | { type: "active-thread/goal-set"; goal: ThreadGoal | null }
  | { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null }
  | ActiveThreadTokenUsageSetAction;

type RuntimeAction =
  | { type: "runtime/requested-model-set"; model: string | null }
  | { type: "runtime/requested-effort-set"; effort: ReasoningEffort | null }
  | { type: "runtime/requested-service-tier-set"; serviceTier: RequestedServiceTier | null }
  | { type: "runtime/requested-approvals-reviewer-set"; approvalsReviewer: ApprovalsReviewer | null }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: CollaborationMode }
  | SetRequestedCollaborationModeDefaultAction
  | { type: "runtime/pending-thread-settings-committed"; update: ThreadSettingsUpdate };

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
  | ClosePanelsAction
  | DetailOpenSetAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

interface RequestResolvedAction {
  type: "request/resolved";
  requestId: PendingApproval["requestId"];
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
  | TranscriptAction
  | TranscriptItemAddedAction
  | ComposerAction
  | UiAction;

export function createChatState(): ChatState {
  return {
    connection: initialConnectionState(),
    threadList: initialThreadListState(),
    activeThread: initialActiveThreadState(),
    runtime: initialRuntimeState(),
    turn: initialTurnState(),
    transcript: initialTranscriptState(),
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
      activeServiceTier: action.serviceTier,
      activeApprovalPolicy: action.approvalPolicy,
      activeApprovalsReviewer: action.approvalsReviewer,
      activePermissionProfile: action.activePermissionProfile,
    },
    turn: initialTurnState(),
    transcript: {
      ...initialTranscriptState(),
      displayItems: action.displayItems ?? [],
    },
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
      transcript: {
        ...initialTranscriptState(),
        displayItems: [action.item],
      },
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
    transcript: {
      ...state.transcript,
      displayItems: action.displayItems ?? state.transcript.displayItems,
    },
  });
}

function reduceTurnCompletedTransition(state: ChatState, action: TurnCompletedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "completed", turnId: action.turnId });
  if (lifecycle === state.turn.lifecycle) return state;
  return patchChatState(state, {
    turn: { lifecycle },
    transcript: { ...state.transcript, displayItems: action.displayItems },
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
    transcript: {
      ...state.transcript,
      displayItems: [...state.transcript.displayItems, action.item],
    },
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
    transcript: { ...state.transcript, displayItems: action.displayItems },
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "start-failed" });
  return patchChatState(state, {
    turn: { lifecycle },
    transcript: { ...state.transcript, displayItems: action.displayItems },
  });
}

function reducePendingStartHookUpsertedTransition(state: ChatState, action: PendingStartHookUpsertedAction): ChatState {
  return patchChatState(state, {
    transcript: {
      ...state.transcript,
      displayItems: upsertDisplayItem(state.transcript.displayItems, action.item),
    },
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, {
        type: "pending-start-hook-upserted",
        pendingTurnStart: action.pendingTurnStart,
      }),
    },
  });
}

function reduceRequestResolvedTransition(state: ChatState, action: RequestResolvedAction): ChatState {
  const displayItems = action.resultItem ? [...state.transcript.displayItems, action.resultItem] : state.transcript.displayItems;
  return patchChatState(state, {
    requests: resolveChatRequest(state.requests, action.requestId),
    transcript: {
      ...state.transcript,
      displayItems,
    },
  });
}

function reduceChatSlices(state: ChatState, action: ChatSliceAction): ChatState {
  return patchChatState(state, {
    connection: reduceConnectionSlice(state.connection, action),
    threadList: reduceThreadListSlice(state.threadList, action),
    activeThread: reduceActiveThreadSlice(state.activeThread, action),
    runtime: reduceRuntimeSlice(state.runtime, action),
    turn: reduceTurnSlice(state.turn, action),
    requests: isRequestAction(action) ? reduceRequestSlice(state.requests, action) : state.requests,
    transcript: isTranscriptAction(action) ? reduceTranscriptSlice(state.transcript, action) : state.transcript,
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
        ...definedPatch("appServerDiagnostics", action.appServerDiagnostics),
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
    case "runtime/requested-model-set":
      return patchObject(state, setRequestedModelRuntimeState(state, action.model));
    case "runtime/requested-effort-set":
      return patchObject(state, setRequestedReasoningEffortRuntimeState(state, action.effort));
    case "runtime/requested-service-tier-set":
      return patchObject(state, setRequestedServiceTierRuntimeState(state, action.serviceTier));
    case "runtime/requested-approvals-reviewer-set":
      return patchObject(state, setRequestedApprovalsReviewerRuntimeState(state, action.approvalsReviewer));
    case "runtime/requested-collaboration-mode-set":
      return patchObject(state, setSelectedCollaborationModeRuntimeState(state, action.collaborationMode));
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, commitPendingThreadSettingsRuntimeState(state, action.update));
    default:
      return state;
  }
}

function reduceTurnSlice(state: ChatTurnState, _action: ChatSliceAction): ChatTurnState {
  return state;
}

function reduceComposerSlice(state: ChatComposerState, action: ChatSliceAction): ChatComposerState {
  switch (action.type) {
    case "composer/draft-set":
      return patchObject(state, {
        draft: action.draft,
        ...(action.clearSuggestions ? { suggestions: [], suggestSelected: 0 } : {}),
        ...(action.resetDismissedSignature ? { suggestionsDismissedSignature: null } : {}),
      });
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
    requests: initialRequestState(),
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
      transcript: initialTranscriptState(),
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
      appServerDiagnostics: createAppServerDiagnostics(),
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
    appServerDiagnostics: createAppServerDiagnostics(),
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

function initialTranscriptState(): ChatTranscriptState {
  return initialChatTranscriptState();
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
    transcript: {
      displayItems: [...state.transcript.displayItems],
      turnDiffs: new Map(state.transcript.turnDiffs),
      historyCursor: state.transcript.historyCursor,
      loadingHistory: state.transcript.loadingHistory,
      reportedLogs: new Set(state.transcript.reportedLogs),
    },
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

function isTranscriptAction(action: ChatSliceAction): action is TranscriptAction {
  return action.type.startsWith("transcript/");
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
