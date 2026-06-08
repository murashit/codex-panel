import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ModeKind } from "../../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ActivePermissionProfile } from "../../generated/app-server/v2/ActivePermissionProfile";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
import type { AskForApproval } from "../../generated/app-server/v2/AskForApproval";
import type { ConfigReadResponse } from "../../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadSettingsUpdateParams } from "../../generated/app-server/v2/ThreadSettingsUpdateParams";
import type { ThreadTokenUsage } from "../../generated/app-server/v2/ThreadTokenUsage";
import type { AppServerDiagnostics } from "../../app-server/compatibility";
import { createAppServerDiagnostics } from "../../app-server/compatibility";
import { parseServiceTier, type RequestedServiceTier, type ServiceTier } from "../../app-server/service-tier";
import {
  resetRuntimeSettingToConfig,
  setPendingRuntimeSetting,
  unchangedRuntimeSetting,
  type PendingRuntimeSetting,
} from "../../runtime/effective-settings";
import type { PendingApproval } from "./requests/approval";
import type { ComposerSuggestion } from "./composer/suggestions";
import { upsertDisplayItem } from "./display/stream-updates";
import type { DisplayItem } from "./display/types";
import type { PendingUserInput } from "./requests/user-input";

export interface PendingTurnStart {
  anchorItemId: string;
  promptSubmitHookItemIds: string[];
}

export type ChatTurnLifecycleState =
  | { kind: "idle" }
  | { kind: "starting"; pendingTurnStart: PendingTurnStart }
  | { kind: "running"; turnId: string };

export type ChatTurnLifecycleEvent =
  | { type: "started"; turnId: string }
  | { type: "completed"; turnId: string }
  | { type: "cleared" }
  | { type: "optimistic-started"; pendingTurnStart: PendingTurnStart }
  | { type: "start-acknowledged"; turnId: string }
  | { type: "start-failed" }
  | { type: "pending-start-hook-upserted"; pendingTurnStart: PendingTurnStart | null };

interface ChatConnectionState {
  status: string;
  effectiveConfig: ConfigReadResponse | null;
  initializeResponse: InitializeResponse | null;
  appServerDiagnostics: AppServerDiagnostics;
  rateLimit: RateLimitSnapshot | null;
  availableModels: readonly Model[];
  availableSkills: readonly SkillMetadata[];
}

interface ChatThreadListState {
  listedThreads: readonly Thread[];
  threadsLoaded: boolean;
}

export interface ChatActiveThreadState {
  id: string | null;
  cwd: string | null;
  creationCliVersion: string | null;
  goal: ThreadGoal | null;
  tokenUsage: ThreadTokenUsage | null;
}

export interface ChatRuntimeState {
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: AskForApproval | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: ModeKind;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
}

export interface ChatTurnState {
  lifecycle: ChatTurnLifecycleState;
}

export interface ChatTranscriptState {
  displayItems: readonly DisplayItem[];
  turnDiffs: ReadonlyMap<string, string>;
  historyCursor: string | null;
  loadingHistory: boolean;
  reportedLogs: ReadonlySet<string>;
}

interface ChatRequestState {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
}

interface ChatComposerState {
  draft: string;
  suggestSelected: number;
  suggestions: readonly ComposerSuggestion[];
  suggestionsDismissedSignature: string | null;
}

interface ChatUiState {
  openDetails: ReadonlySet<string>;
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
  | { type: "connection/initialized"; initializeResponse: InitializeResponse }
  | {
      type: "connection/metadata-applied";
      effectiveConfig?: ConfigReadResponse | null;
      availableModels?: readonly Model[];
      availableSkills?: readonly SkillMetadata[];
      rateLimit?: RateLimitSnapshot | null;
      appServerDiagnostics?: AppServerDiagnostics;
    };

interface ThreadListAppliedAction {
  type: "thread-list/applied";
  threads?: readonly Thread[];
  threadsLoaded?: boolean;
}

type ThreadListAction = ThreadListAppliedAction;

export interface ActiveThreadResumedAction {
  type: "active-thread/resumed";
  thread: Thread;
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  displayItems?: readonly DisplayItem[];
  status?: string;
  listedThreads?: readonly Thread[];
}

export interface ActiveThreadSettingsAppliedAction {
  type: "active-thread/settings-applied";
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  collaborationMode: ModeKind;
  serviceTier: ServiceTier | null;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
}

type ActiveThreadAction =
  | { type: "active-thread/cwd-set"; cwd: string | null }
  | { type: "active-thread/goal-set"; goal: ThreadGoal | null }
  | { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/requested-model-set"; model: string | null }
  | { type: "runtime/requested-effort-set"; effort: ReasoningEffort | null }
  | { type: "runtime/requested-service-tier-set"; serviceTier: RequestedServiceTier | null }
  | { type: "runtime/requested-approvals-reviewer-set"; approvalsReviewer: ApprovalsReviewer | null }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: ModeKind }
  | { type: "runtime/pending-thread-settings-committed"; update: Omit<ThreadSettingsUpdateParams, "threadId"> };

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

interface TurnScopedClearedAction {
  type: "turn/scoped-cleared";
}

interface TurnOptimisticStartedAction {
  type: "turn/optimistic-started";
  item: DisplayItem;
  pendingTurnStart: PendingTurnStart;
}

interface TurnStartAcknowledgedAction {
  type: "turn/start-acknowledged";
  turnId: string;
  displayItems: readonly DisplayItem[];
}

interface TurnStartFailedAction {
  type: "turn/start-failed";
  displayItems: readonly DisplayItem[];
}

type TurnAction =
  | TurnStartedAction
  | TurnCompletedAction
  | TurnScopedClearedAction
  | TurnOptimisticStartedAction
  | TurnStartAcknowledgedAction
  | TurnStartFailedAction;

type RequestAction =
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/user-input-draft-set"; key: string; value: string };

type TranscriptAction =
  | { type: "transcript/item-added"; item: DisplayItem }
  | { type: "transcript/system-message-added"; item: DisplayItem }
  | { type: "transcript/deduped-log-added"; text: string; item: DisplayItem }
  | { type: "transcript/history-loading-set"; loading: boolean }
  | {
      type: "transcript/items-replaced";
      items: readonly DisplayItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
    }
  | { type: "transcript/item-upserted"; item: DisplayItem }
  | { type: "transcript/turn-diff-updated"; turnId: string; diff: string };

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
  | { type: "ui/detail-open-set"; key: string; open: boolean };

export type ChatAction = ChatTransitionAction | ChatSliceAction;

interface ConnectionScopedClearedAction {
  type: "connection/scoped-cleared";
}

interface ActiveThreadClearedAction {
  type: "active-thread/cleared";
}

interface ActiveThreadRestoredPlaceholderAction {
  type: "active-thread/restored-placeholder";
  threadId: string;
  item: DisplayItem;
}

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
  | ConnectionScopedClearedAction
  | ActiveThreadClearedAction
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
  | TranscriptAction
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
      return reduceConnectionScopedClearedTransition(state);
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

function reduceConnectionScopedClearedTransition(state: ChatState): ChatState {
  return clearConnectionScopedState(state);
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
      creationCliVersion: action.thread.cliVersion,
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
        creationCliVersion: null,
        goal: null,
        tokenUsage: null,
      },
      runtime: {
        ...state.runtime,
        ...initialActiveRuntimeState(),
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
  const resolvedInputs = state.requests.pendingUserInputs.filter((input) => input.requestId === action.requestId);
  const draftKeys = new Set(
    resolvedInputs.flatMap((input) =>
      input.params.questions.flatMap((question) => [
        `${String(input.requestId)}:${question.id}`,
        `${String(input.requestId)}:${question.id}:other`,
      ]),
    ),
  );
  const userInputDrafts = new Map([...state.requests.userInputDrafts].filter(([key]) => !draftKeys.has(key)));
  const displayItems = action.resultItem ? [...state.transcript.displayItems, action.resultItem] : state.transcript.displayItems;
  return patchChatState(state, {
    requests: {
      approvals: state.requests.approvals.filter((approval) => approval.requestId !== action.requestId),
      pendingUserInputs: state.requests.pendingUserInputs.filter((input) => input.requestId !== action.requestId),
      userInputDrafts,
    },
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
    requests: reduceRequestSlice(state.requests, action),
    transcript: reduceTranscriptSlice(state.transcript, action),
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
        ...definedPatch("effectiveConfig", action.effectiveConfig),
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
      return patchObject(state, {
        requestedModel: action.model === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(action.model),
      });
    case "runtime/requested-effort-set":
      return patchObject(state, {
        requestedReasoningEffort: action.effort === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(action.effort),
      });
    case "runtime/requested-service-tier-set":
      return patchObject(state, {
        requestedServiceTier: action.serviceTier === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(action.serviceTier),
      });
    case "runtime/requested-approvals-reviewer-set":
      return patchObject(state, {
        requestedApprovalsReviewer:
          action.approvalsReviewer === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(action.approvalsReviewer),
      });
    case "runtime/requested-collaboration-mode-set":
      return patchObject(state, { selectedCollaborationMode: action.collaborationMode });
    case "runtime/pending-thread-settings-committed":
      return commitPendingThreadSettings(state, action.update);
    default:
      return state;
  }
}

function reduceTurnSlice(state: ChatTurnState, _action: ChatSliceAction): ChatTurnState {
  return state;
}

function reduceRequestSlice(state: ChatRequestState, action: ChatSliceAction): ChatRequestState {
  switch (action.type) {
    case "request/approval-queued":
      if (state.approvals.some((existing) => existing.requestId === action.approval.requestId)) return state;
      return patchObject(state, { approvals: [...state.approvals, action.approval] });
    case "request/user-input-queued":
      if (state.pendingUserInputs.some((existing) => existing.requestId === action.input.requestId)) return state;
      return patchObject(state, { pendingUserInputs: [...state.pendingUserInputs, action.input] });
    case "request/user-input-draft-set":
      return setUserInputDraftSlice(state, action.key, action.value);
    default:
      return state;
  }
}

function reduceTranscriptSlice(state: ChatTranscriptState, action: ChatSliceAction): ChatTranscriptState {
  switch (action.type) {
    case "transcript/item-added":
    case "transcript/system-message-added":
      return patchObject(state, { displayItems: [...state.displayItems, action.item] });
    case "transcript/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchObject(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        displayItems: [...state.displayItems, action.item],
      });
    case "transcript/items-replaced":
      return patchObject(state, {
        displayItems: action.items,
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
      });
    case "transcript/history-loading-set":
      return patchObject(state, { loadingHistory: action.loading });
    case "transcript/item-upserted":
      return patchObject(state, { displayItems: upsertDisplayItem(state.displayItems, action.item) });
    case "transcript/turn-diff-updated":
      return patchObject(state, {
        turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff),
      });
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
        ...initialActiveRuntimeState(),
      },
      transcript: initialTranscriptState(),
      composer: initialComposerState(),
      ui: initialUiState(),
    }),
  );
}

function clearConnectionScopedState(state: ChatState): ChatState {
  return patchChatState(clearActiveTurnState(state), {
    activeThread: initialActiveThreadState(),
    runtime: {
      ...state.runtime,
      ...initialActiveRuntimeState(),
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
    effectiveConfig: null,
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
    creationCliVersion: null,
    goal: null,
    tokenUsage: null,
  };
}

function initialActiveRuntimeState(): Pick<
  ChatRuntimeState,
  | "activeModel"
  | "activeReasoningEffort"
  | "activeCollaborationMode"
  | "activeServiceTier"
  | "activeApprovalPolicy"
  | "activeApprovalsReviewer"
  | "activePermissionProfile"
> {
  return {
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalPolicy: null,
    activeApprovalsReviewer: null,
    activePermissionProfile: null,
  };
}

function initialRuntimeState(): ChatRuntimeState {
  return {
    ...initialActiveRuntimeState(),
    requestedModel: unchangedRuntimeSetting(),
    requestedReasoningEffort: unchangedRuntimeSetting(),
    requestedApprovalsReviewer: unchangedRuntimeSetting(),
    selectedCollaborationMode: "default",
    requestedServiceTier: unchangedRuntimeSetting(),
  };
}

function initialTurnState(): ChatTurnState {
  return {
    lifecycle: { kind: "idle" },
  };
}

function initialTranscriptState(): ChatTranscriptState {
  return {
    displayItems: [],
    turnDiffs: new Map(),
    historyCursor: null,
    loadingHistory: false,
    reportedLogs: new Set(),
  };
}

function initialRequestState(): ChatRequestState {
  return {
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
  };
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
    },
  };
}

export function chatTurnBusy(state: Pick<ChatState, "turn"> | { lifecycle: ChatTurnLifecycleState }): boolean {
  return turnLifecycleFor(state).kind !== "idle";
}

export function activeTurnId(state: Pick<ChatState, "turn"> | { lifecycle: ChatTurnLifecycleState }): string | null {
  const lifecycle = turnLifecycleFor(state);
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

export function pendingTurnStart(state: Pick<ChatState, "turn"> | { lifecycle: ChatTurnLifecycleState }): PendingTurnStart | null {
  const lifecycle = turnLifecycleFor(state);
  return lifecycle.kind === "starting" ? lifecycle.pendingTurnStart : null;
}

function turnLifecycleFor(state: Pick<ChatState, "turn"> | { lifecycle: ChatTurnLifecycleState }): ChatTurnLifecycleState {
  if ("turn" in state) return state.turn.lifecycle;
  return state.lifecycle;
}

export function transitionChatTurnLifecycleState(state: ChatTurnLifecycleState, event: ChatTurnLifecycleEvent): ChatTurnLifecycleState {
  switch (event.type) {
    case "started":
      return { kind: "running", turnId: event.turnId };
    case "completed":
      return state.kind === "running" && state.turnId === event.turnId ? { kind: "idle" } : state;
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
    case "optimistic-started":
      return { kind: "starting", pendingTurnStart: event.pendingTurnStart };
    case "start-acknowledged":
      if (state.kind === "idle") return state;
      if (state.kind === "running" && state.turnId !== event.turnId) return state;
      return { kind: "running", turnId: event.turnId };
    case "start-failed":
      return { kind: "idle" };
    case "pending-start-hook-upserted":
      if (event.pendingTurnStart) return { kind: "starting", pendingTurnStart: event.pendingTurnStart };
      return state.kind === "starting" ? { kind: "idle" } : state;
  }
}

function updatedTurnDiffs(turnDiffs: ReadonlyMap<string, string>, turnId: string, diff: string): ReadonlyMap<string, string> {
  const next = new Map(turnDiffs);
  if (diff.trim().length > 0) {
    next.set(turnId, diff);
  } else {
    next.delete(turnId);
  }
  return next;
}

function setPanelSlice(state: ChatUiState, panel: "history" | "chat-actions" | "status-panel" | null, toggle: boolean): ChatUiState {
  const currentPanel = state.openDetails.has("history")
    ? "history"
    : state.openDetails.has("chat-actions")
      ? "chat-actions"
      : state.openDetails.has("status-panel")
        ? "status-panel"
        : null;
  const nextPanel = toggle && currentPanel === panel ? null : panel;
  const toolbarPanelKeys = new Set(["history", "chat-actions", "status-panel"]);
  return patchObject(state, {
    openDetails: nextPanel ? new Set([nextPanel]) : new Set([...state.openDetails].filter((key) => !toolbarPanelKeys.has(key))),
  });
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

function setUserInputDraftSlice(state: ChatRequestState, key: string, value: string): ChatRequestState {
  if (state.userInputDrafts.get(key) === value) return state;
  return patchObject(state, { userInputDrafts: new Map([...state.userInputDrafts, [key, value]]) });
}

function commitPendingThreadSettings(state: ChatRuntimeState, update: Omit<ThreadSettingsUpdateParams, "threadId">): ChatRuntimeState {
  return patchObject(state, {
    ...("model" in update ? { activeModel: update.model ?? null, requestedModel: unchangedRuntimeSetting<string>() } : {}),
    ...("effort" in update
      ? { activeReasoningEffort: update.effort ?? null, requestedReasoningEffort: unchangedRuntimeSetting<ReasoningEffort>() }
      : {}),
    ...("serviceTier" in update
      ? { activeServiceTier: parseServiceTier(update.serviceTier), requestedServiceTier: unchangedRuntimeSetting<RequestedServiceTier>() }
      : {}),
    ...("approvalsReviewer" in update
      ? {
          activeApprovalsReviewer: update.approvalsReviewer ?? null,
          requestedApprovalsReviewer: unchangedRuntimeSetting<ApprovalsReviewer>(),
        }
      : {}),
    ...(update.collaborationMode ? { activeCollaborationMode: update.collaborationMode.mode } : {}),
  });
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
