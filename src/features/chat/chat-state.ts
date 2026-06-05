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
import type { ThreadSettingsUpdateParams } from "../../generated/app-server/v2/ThreadSettingsUpdateParams";
import type { ThreadTokenUsage } from "../../generated/app-server/v2/ThreadTokenUsage";
import type { AppServerDiagnostics } from "../../app-server/compatibility";
import { createAppServerDiagnostics } from "../../app-server/compatibility";
import type { PendingApproval } from "./approvals/model";
import type { ComposerSuggestion } from "./composer/suggestions";
import type { DisplayItem } from "./display/types";
import { upsertDisplayItem } from "./display/stream-updates";
import type { PendingUserInput } from "./user-input/model";
import { parseServiceTier, type RequestedServiceTier, type ServiceTier } from "../../app-server/service-tier";
import {
  resetRuntimeSettingToConfig,
  setPendingRuntimeSetting,
  unchangedRuntimeSetting,
  type PendingRuntimeSetting,
} from "../../runtime/state";

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
  | { type: "pending-turn-item-upserted"; pendingTurnStart: PendingTurnStart | null };

export interface ChatState {
  status: string;
  effectiveConfig: ConfigReadResponse | null;
  initializeResponse: InitializeResponse | null;
  activeThreadId: string | null;
  activeThreadCwd: string | null;
  turnLifecycle: ChatTurnLifecycleState;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ServiceTier | null;
  activeApprovalPolicy: AskForApproval | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  activeThreadCreationCliVersion: string | null;
  appServerDiagnostics: AppServerDiagnostics;
  requestedModel: PendingRuntimeSetting<string>;
  requestedReasoningEffort: PendingRuntimeSetting<ReasoningEffort>;
  requestedApprovalsReviewer: PendingRuntimeSetting<ApprovalsReviewer>;
  selectedCollaborationMode: ModeKind;
  requestedServiceTier: PendingRuntimeSetting<RequestedServiceTier>;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  displayItems: readonly DisplayItem[];
  turnDiffs: ReadonlyMap<string, string>;
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  listedThreads: readonly Thread[];
  threadsLoaded: boolean;
  historyCursor: string | null;
  loadingHistory: boolean;
  composerDraft: string;
  availableModels: readonly Model[];
  availableSkills: readonly SkillMetadata[];
  reportedLogs: ReadonlySet<string>;
  composerSuggestSelected: number;
  composerSuggestions: readonly ComposerSuggestion[];
  composerSuggestionsDismissedSignature: string | null;
  messagesPinnedToBottom: boolean;
  openDetails: ReadonlySet<string>;
}

export interface ChatStateStore {
  getState(): ChatState;
  dispatch(action: ChatAction): ChatState;
  subscribe(listener: () => void): () => void;
}

export type ChatAction =
  | { type: "status/set"; status: string }
  | { type: "system/message-added"; item: DisplayItem }
  | { type: "system/deduped-log-added"; text: string; item: DisplayItem }
  | { type: "connection/scoped-cleared" }
  | { type: "thread/active-cleared" }
  | {
      type: "thread/resumed";
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
      forceMessagesToBottom?: boolean;
    }
  | {
      type: "thread/list-applied";
      threads?: readonly Thread[];
      threadsLoaded?: boolean;
      effectiveConfig?: ConfigReadResponse | null;
      availableModels?: readonly Model[];
      availableSkills?: readonly SkillMetadata[];
      rateLimit?: RateLimitSnapshot | null;
      appServerDiagnostics?: AppServerDiagnostics;
    }
  | {
      type: "turn/started";
      threadId: string;
      turnId: string;
      displayItems?: readonly DisplayItem[];
    }
  | { type: "turn/completed"; turnId: string; status: string; displayItems: readonly DisplayItem[] }
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/resolved"; requestId: PendingApproval["requestId"]; resultItem?: DisplayItem }
  | {
      type: "display/items-replaced";
      items: readonly DisplayItem[];
      historyCursor?: string | null;
      loadingHistory?: boolean;
      messagesPinnedToBottom?: boolean;
    }
  | { type: "display/item-upserted"; item: DisplayItem }
  | { type: "display/turn-diff-updated"; turnId: string; diff: string }
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
    }
  | {
      type: "ui/panel-set";
      panel: "history" | "status-panel" | null;
      toggle?: boolean;
    }
  | { type: "ui/messages-pinned-set"; pinned: boolean }
  | { type: "ui/detail-open-set"; key: string; open: boolean }
  | { type: "request/user-input-draft-set"; key: string; value: string }
  | { type: "runtime/requested-model-set"; model: string | null }
  | { type: "runtime/requested-effort-set"; effort: ReasoningEffort | null }
  | { type: "runtime/requested-service-tier-set"; serviceTier: RequestedServiceTier | null }
  | { type: "runtime/requested-approvals-reviewer-set"; approvalsReviewer: ApprovalsReviewer | null }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: ModeKind }
  | { type: "runtime/pending-thread-settings-committed"; update: Omit<ThreadSettingsUpdateParams, "threadId"> }
  | { type: "connection/initialized"; initializeResponse: InitializeResponse }
  | { type: "thread/cwd-set"; cwd: string | null }
  | { type: "thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null }
  | {
      type: "thread/settings-applied";
      cwd: string;
      model: string | null;
      reasoningEffort: ReasoningEffort | null;
      collaborationMode: ModeKind;
      serviceTier: ServiceTier | null;
      approvalPolicy: AskForApproval | null;
      approvalsReviewer: ApprovalsReviewer | null;
      activePermissionProfile: ActivePermissionProfile | null;
    }
  | { type: "thread/restored-placeholder"; threadId: string; item: DisplayItem }
  | { type: "history/loading-set"; loading: boolean }
  | { type: "turn/local-cleared" }
  | { type: "turn/optimistic-started"; item: DisplayItem; pendingTurnStart: PendingTurnStart }
  | { type: "turn/start-acknowledged"; turnId: string; displayItems: readonly DisplayItem[] }
  | { type: "turn/start-failed"; displayItems: readonly DisplayItem[] }
  | { type: "display/pending-turn-item-upserted"; item: DisplayItem; pendingTurnStart: PendingTurnStart | null };

type ConnectionAction = Extract<ChatAction, { type: `connection/${string}` }>;
type ThreadAction = Extract<ChatAction, { type: `thread/${string}` }> | Extract<ChatAction, { type: `history/${string}` }>;
type TurnAction = Extract<ChatAction, { type: `turn/${string}` }>;
type RequestAction = Extract<ChatAction, { type: `request/${string}` }>;
type DisplayAction = Extract<ChatAction, { type: `display/${string}` }> | Extract<ChatAction, { type: `system/${string}` }>;
type ComposerAction = Extract<ChatAction, { type: `composer/${string}` }>;
type UiAction = Extract<ChatAction, { type: `ui/${string}` }>;
type RuntimeAction = Extract<ChatAction, { type: `runtime/${string}` }>;

export function createChatState(): ChatState {
  return {
    status: "Idle",
    effectiveConfig: null,
    initializeResponse: null,
    activeThreadId: null,
    activeThreadCwd: null,
    turnLifecycle: { kind: "idle" },
    ...initialActiveRuntimeState(),
    activeThreadCreationCliVersion: null,
    appServerDiagnostics: createAppServerDiagnostics(),
    ...initialRequestedRuntimeState(),
    tokenUsage: null,
    rateLimit: null,
    ...initialDisplayState(),
    ...initialPendingRequestState(),
    listedThreads: [],
    threadsLoaded: false,
    ...initialHistoryState(),
    ...initialComposerState(),
    ...initialPanelUiState(),
    availableModels: [],
    availableSkills: [],
    reportedLogs: new Set(),
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
  if (action.type === "status/set") return patchChatState(state, { status: action.status });
  if (isConnectionAction(action)) return reduceConnectionState(state, action);
  if (isThreadAction(action)) return reduceThreadState(state, action);
  if (isTurnAction(action)) return reduceTurnState(state, action);
  if (isRequestAction(action)) return reduceRequestState(state, action);
  if (isDisplayAction(action)) return reduceDisplayState(state, action);
  if (isComposerAction(action)) return reduceComposerState(state, action);
  if (isUiAction(action)) return reduceUiState(state, action);
  if (isRuntimeAction(action)) return reduceRuntimeState(state, action);
  return assertNever(action);
}

function isConnectionAction(action: ChatAction): action is ConnectionAction {
  return action.type.startsWith("connection/");
}

function isThreadAction(action: ChatAction): action is ThreadAction {
  return action.type.startsWith("thread/") || action.type.startsWith("history/");
}

function isTurnAction(action: ChatAction): action is TurnAction {
  return action.type.startsWith("turn/");
}

function isRequestAction(action: ChatAction): action is RequestAction {
  return action.type.startsWith("request/");
}

function isDisplayAction(action: ChatAction): action is DisplayAction {
  return action.type.startsWith("display/") || action.type.startsWith("system/");
}

function isComposerAction(action: ChatAction): action is ComposerAction {
  return action.type.startsWith("composer/");
}

function isUiAction(action: ChatAction): action is UiAction {
  return action.type.startsWith("ui/");
}

function isRuntimeAction(action: ChatAction): action is RuntimeAction {
  return action.type.startsWith("runtime/");
}

function reduceConnectionState(state: ChatState, action: ConnectionAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
      return clearConnectionScopedState(state);
    case "connection/initialized":
      return patchChatState(state, { initializeResponse: action.initializeResponse });
  }
}

function reduceThreadState(state: ChatState, action: ThreadAction): ChatState {
  switch (action.type) {
    case "thread/active-cleared":
      return clearActiveThreadState(state);
    case "thread/resumed":
      return patchChatState(state, {
        activeThreadId: action.thread.id,
        activeThreadCwd: action.cwd,
        turnLifecycle: { kind: "idle" },
        activeModel: action.model,
        activeReasoningEffort: action.reasoningEffort,
        activeServiceTier: action.serviceTier,
        activeApprovalPolicy: action.approvalPolicy,
        activeApprovalsReviewer: action.approvalsReviewer,
        activePermissionProfile: action.activePermissionProfile,
        activeThreadCreationCliVersion: action.thread.cliVersion,
        tokenUsage: null,
        ...initialHistoryState(),
        ...initialPendingRequestState(),
        ...initialComposerState(),
        turnDiffs: new Map(),
        displayItems: action.displayItems ?? [],
        listedThreads: action.listedThreads ?? state.listedThreads,
        messagesPinnedToBottom: action.forceMessagesToBottom ?? true,
        status: action.status ?? state.status,
      });
    case "thread/list-applied":
      return patchChatState(state, {
        ...definedPatch("listedThreads", action.threads),
        ...definedPatch("threadsLoaded", action.threadsLoaded),
        ...definedPatch("effectiveConfig", action.effectiveConfig),
        ...definedPatch("availableModels", action.availableModels),
        ...definedPatch("availableSkills", action.availableSkills),
        ...definedPatch("rateLimit", action.rateLimit),
        ...definedPatch("appServerDiagnostics", action.appServerDiagnostics),
      });
    case "thread/cwd-set":
      return patchChatState(state, { activeThreadCwd: action.cwd });
    case "thread/token-usage-set":
      return patchChatState(state, { tokenUsage: action.tokenUsage });
    case "thread/settings-applied":
      return patchChatState(state, {
        activeThreadCwd: action.cwd,
        activeModel: action.model,
        activeReasoningEffort: action.reasoningEffort,
        activeCollaborationMode: action.collaborationMode,
        selectedCollaborationMode: action.collaborationMode,
        activeServiceTier: action.serviceTier,
        activeApprovalPolicy: action.approvalPolicy,
        activeApprovalsReviewer: action.approvalsReviewer,
        activePermissionProfile: action.activePermissionProfile,
      });
    case "thread/restored-placeholder":
      return clearActiveTurnState(
        patchChatState(state, {
          activeThreadId: action.threadId,
          activeThreadCwd: null,
          ...initialActiveRuntimeState(),
          activeThreadCreationCliVersion: null,
          tokenUsage: null,
          ...initialHistoryState(),
          displayItems: [action.item],
          turnDiffs: new Map(),
          messagesPinnedToBottom: true,
        }),
      );
    case "history/loading-set":
      return patchChatState(state, { loadingHistory: action.loading });
  }
}

function reduceTurnState(state: ChatState, action: TurnAction): ChatState {
  switch (action.type) {
    case "turn/started": {
      const turnLifecycle = transitionChatTurnLifecycleState(state.turnLifecycle, { type: "started", turnId: action.turnId });
      return patchChatState(state, {
        activeThreadId: action.threadId,
        turnLifecycle,
        status: "Turn running...",
        displayItems: action.displayItems ?? state.displayItems,
      });
    }
    case "turn/completed": {
      const turnLifecycle = transitionChatTurnLifecycleState(state.turnLifecycle, { type: "completed", turnId: action.turnId });
      if (turnLifecycle === state.turnLifecycle) return state;
      return patchChatState(state, {
        turnLifecycle,
        displayItems: action.displayItems,
        status: `Turn ${action.status}.`,
      });
    }
    case "turn/local-cleared":
      return clearActiveTurnState(state);
    case "turn/optimistic-started": {
      const turnLifecycle = transitionChatTurnLifecycleState(state.turnLifecycle, {
        type: "optimistic-started",
        pendingTurnStart: action.pendingTurnStart,
      });
      return patchChatState(state, {
        turnLifecycle,
        displayItems: [...state.displayItems, action.item],
      });
    }
    case "turn/start-acknowledged": {
      const turnLifecycle = transitionChatTurnLifecycleState(state.turnLifecycle, {
        type: "start-acknowledged",
        turnId: action.turnId,
      });
      if (turnLifecycle === state.turnLifecycle) return state;
      return patchChatState(state, {
        turnLifecycle,
        displayItems: action.displayItems,
      });
    }
    case "turn/start-failed": {
      const turnLifecycle = transitionChatTurnLifecycleState(state.turnLifecycle, { type: "start-failed" });
      return patchChatState(state, {
        turnLifecycle,
        displayItems: action.displayItems,
      });
    }
  }
}

function reduceRequestState(state: ChatState, action: RequestAction): ChatState {
  switch (action.type) {
    case "request/approval-queued":
      if (state.approvals.some((existing) => existing.requestId === action.approval.requestId)) return state;
      return patchChatState(state, { approvals: [...state.approvals, action.approval] });
    case "request/user-input-queued":
      if (state.pendingUserInputs.some((existing) => existing.requestId === action.input.requestId)) return state;
      return patchChatState(state, { pendingUserInputs: [...state.pendingUserInputs, action.input] });
    case "request/resolved":
      return resolveRequest(state, action.requestId, action.resultItem);
    case "request/user-input-draft-set":
      return setUserInputDraftState(state, action.key, action.value);
  }
}

function reduceDisplayState(state: ChatState, action: DisplayAction): ChatState {
  switch (action.type) {
    case "system/message-added":
      return patchChatState(state, { displayItems: [...state.displayItems, action.item] });
    case "system/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchChatState(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        displayItems: [...state.displayItems, action.item],
      });
    case "display/items-replaced":
      return patchChatState(state, {
        displayItems: action.items,
        ...definedPatch("historyCursor", action.historyCursor),
        ...definedPatch("loadingHistory", action.loadingHistory),
        ...definedPatch("messagesPinnedToBottom", action.messagesPinnedToBottom),
      });
    case "display/item-upserted":
      return patchChatState(state, { displayItems: upsertDisplayItem(state.displayItems, action.item) });
    case "display/turn-diff-updated":
      return patchChatState(state, { turnDiffs: updatedTurnDiffs(state.turnDiffs, action.turnId, action.diff) });
    case "display/pending-turn-item-upserted":
      return patchChatState(state, {
        displayItems: upsertDisplayItem(state.displayItems, action.item),
        turnLifecycle: transitionChatTurnLifecycleState(state.turnLifecycle, {
          type: "pending-turn-item-upserted",
          pendingTurnStart: action.pendingTurnStart,
        }),
      });
  }
}

function reduceComposerState(state: ChatState, action: ComposerAction): ChatState {
  switch (action.type) {
    case "composer/draft-set":
      return patchChatState(state, {
        composerDraft: action.draft,
        ...(action.clearSuggestions ? { composerSuggestions: [], composerSuggestSelected: 0 } : {}),
        ...(action.resetDismissedSignature ? { composerSuggestionsDismissedSignature: null } : {}),
      });
    case "composer/suggestions-set":
      return setComposerSuggestionsState(
        state,
        action.suggestions,
        action.selected ?? state.composerSuggestSelected,
        action.dismissedSignature === undefined ? state.composerSuggestionsDismissedSignature : action.dismissedSignature,
      );
  }
}

function reduceUiState(state: ChatState, action: UiAction): ChatState {
  switch (action.type) {
    case "ui/panel-set":
      return setPanelState(state, action.panel, action.toggle ?? false);
    case "ui/messages-pinned-set":
      return patchChatState(state, { messagesPinnedToBottom: action.pinned });
    case "ui/detail-open-set":
      return setDetailOpenState(state, action.key, action.open);
  }
}

function reduceRuntimeState(state: ChatState, action: RuntimeAction): ChatState {
  switch (action.type) {
    case "runtime/requested-model-set":
      return patchChatState(state, {
        requestedModel: action.model === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(action.model),
      });
    case "runtime/requested-effort-set":
      return patchChatState(state, {
        requestedReasoningEffort: action.effort === null ? resetRuntimeSettingToConfig() : setPendingRuntimeSetting(action.effort),
      });
    case "runtime/requested-service-tier-set":
      return patchChatState(state, {
        requestedServiceTier: action.serviceTier === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(action.serviceTier),
      });
    case "runtime/requested-approvals-reviewer-set":
      return patchChatState(state, {
        requestedApprovalsReviewer:
          action.approvalsReviewer === null ? unchangedRuntimeSetting() : setPendingRuntimeSetting(action.approvalsReviewer),
      });
    case "runtime/requested-collaboration-mode-set":
      return patchChatState(state, { selectedCollaborationMode: action.collaborationMode });
    case "runtime/pending-thread-settings-committed":
      return commitPendingThreadSettings(state, action.update);
  }
}

export function clearActiveTurnState(state: ChatState): ChatState {
  return patchChatState(state, {
    turnLifecycle: transitionChatTurnLifecycleState(state.turnLifecycle, { type: "cleared" }),
    ...initialPendingRequestState(),
  });
}

export function clearActiveThreadState(state: ChatState): ChatState {
  return clearActiveTurnState(
    patchChatState(state, {
      activeThreadId: null,
      activeThreadCwd: null,
      ...initialActiveRuntimeState(),
      activeThreadCreationCliVersion: null,
      tokenUsage: null,
      ...initialHistoryState(),
      ...initialDisplayState(),
      ...initialComposerState(),
    }),
  );
}

export function clearConnectionScopedState(state: ChatState): ChatState {
  return patchChatState(clearActiveTurnState(state), {
    ...initialActiveRuntimeState(),
    activeThreadCreationCliVersion: null,
    rateLimit: null,
    listedThreads: [],
    threadsLoaded: false,
    availableModels: [],
    availableSkills: [],
    appServerDiagnostics: createAppServerDiagnostics(),
  });
}

function initialActiveRuntimeState(): Pick<
  ChatState,
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

function initialRequestedRuntimeState(): Pick<
  ChatState,
  "requestedModel" | "requestedReasoningEffort" | "requestedApprovalsReviewer" | "selectedCollaborationMode" | "requestedServiceTier"
> {
  return {
    requestedModel: unchangedRuntimeSetting(),
    requestedReasoningEffort: unchangedRuntimeSetting(),
    requestedApprovalsReviewer: unchangedRuntimeSetting(),
    selectedCollaborationMode: "default",
    requestedServiceTier: unchangedRuntimeSetting(),
  };
}

function initialDisplayState(): Pick<ChatState, "displayItems" | "turnDiffs" | "messagesPinnedToBottom"> {
  return {
    displayItems: [],
    turnDiffs: new Map(),
    messagesPinnedToBottom: true,
  };
}

function initialPendingRequestState(): Pick<ChatState, "approvals" | "pendingUserInputs" | "userInputDrafts"> {
  return {
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
  };
}

function initialHistoryState(): Pick<ChatState, "historyCursor" | "loadingHistory"> {
  return {
    historyCursor: null,
    loadingHistory: false,
  };
}

function initialComposerState(): Pick<
  ChatState,
  "composerDraft" | "composerSuggestSelected" | "composerSuggestions" | "composerSuggestionsDismissedSignature"
> {
  return {
    composerDraft: "",
    composerSuggestSelected: 0,
    composerSuggestions: [],
    composerSuggestionsDismissedSignature: null,
  };
}

function initialPanelUiState(): Pick<ChatState, "openDetails"> {
  return {
    openDetails: new Set(),
  };
}

export function cloneChatState(state: ChatState): ChatState {
  return {
    ...state,
    displayItems: [...state.displayItems],
    turnDiffs: new Map(state.turnDiffs),
    approvals: [...state.approvals],
    pendingUserInputs: [...state.pendingUserInputs],
    userInputDrafts: new Map(state.userInputDrafts),
    listedThreads: [...state.listedThreads],
    availableModels: [...state.availableModels],
    availableSkills: [...state.availableSkills],
    reportedLogs: new Set(state.reportedLogs),
    composerSuggestions: [...state.composerSuggestions],
    openDetails: new Set(state.openDetails),
  };
}

function resolveRequest(state: ChatState, requestId: PendingApproval["requestId"], resultItem: DisplayItem | undefined): ChatState {
  const resolvedInputs = state.pendingUserInputs.filter((input) => input.requestId === requestId);
  const draftKeys = new Set(
    resolvedInputs.flatMap((input) =>
      input.params.questions.flatMap((question) => [
        `${String(input.requestId)}:${question.id}`,
        `${String(input.requestId)}:${question.id}:other`,
      ]),
    ),
  );
  const userInputDrafts = new Map([...state.userInputDrafts].filter(([key]) => !draftKeys.has(key)));
  const displayItems = resultItem ? [...state.displayItems, resultItem] : state.displayItems;
  return patchChatState(state, {
    approvals: state.approvals.filter((approval) => approval.requestId !== requestId),
    pendingUserInputs: state.pendingUserInputs.filter((input) => input.requestId !== requestId),
    userInputDrafts,
    displayItems,
  });
}

export function chatTurnBusy(state: Pick<ChatState, "turnLifecycle">): boolean {
  return state.turnLifecycle.kind !== "idle";
}

export function activeTurnId(state: Pick<ChatState, "turnLifecycle">): string | null {
  return state.turnLifecycle.kind === "running" ? state.turnLifecycle.turnId : null;
}

export function pendingTurnStart(state: Pick<ChatState, "turnLifecycle">): PendingTurnStart | null {
  return state.turnLifecycle.kind === "starting" ? state.turnLifecycle.pendingTurnStart : null;
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
    case "pending-turn-item-upserted":
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

function setPanelState(state: ChatState, panel: "history" | "status-panel" | null, toggle: boolean): ChatState {
  const currentPanel = state.openDetails.has("history") ? "history" : state.openDetails.has("status-panel") ? "status-panel" : null;
  const nextPanel = toggle && currentPanel === panel ? null : panel;
  return patchChatState(state, {
    openDetails:
      nextPanel === "history" || nextPanel === "status-panel"
        ? new Set([nextPanel])
        : new Set([...state.openDetails].filter((key) => key !== "history" && key !== "status-panel")),
  });
}

function setDetailOpenState(state: ChatState, key: string, open: boolean): ChatState {
  if (state.openDetails.has(key) === open) return state;
  const openDetails = new Set(state.openDetails);
  if (open) {
    openDetails.add(key);
  } else {
    openDetails.delete(key);
  }
  return patchChatState(state, { openDetails });
}

function setUserInputDraftState(state: ChatState, key: string, value: string): ChatState {
  if (state.userInputDrafts.get(key) === value) return state;
  return patchChatState(state, { userInputDrafts: new Map([...state.userInputDrafts, [key, value]]) });
}

function commitPendingThreadSettings(state: ChatState, update: Omit<ThreadSettingsUpdateParams, "threadId">): ChatState {
  return patchChatState(state, {
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

function setComposerSuggestionsState(
  state: ChatState,
  suggestions: readonly ComposerSuggestion[],
  selected: number,
  dismissedSignature: string | null,
): ChatState {
  if (
    state.composerSuggestSelected === selected &&
    state.composerSuggestionsDismissedSignature === dismissedSignature &&
    composerSuggestionsEqual(state.composerSuggestions, suggestions)
  ) {
    return state;
  }
  return patchChatState(state, {
    composerSuggestions: suggestions,
    composerSuggestSelected: selected,
    composerSuggestionsDismissedSignature: dismissedSignature,
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

function patchChatState(state: ChatState, patch: Partial<ChatState>): ChatState {
  if (Object.entries(patch).every(([key, value]) => Object.is(state[key as keyof ChatState], value))) return state;
  return { ...state, ...patch };
}

function definedPatch<Key extends keyof ChatState>(key: Key, value: ChatState[Key] | undefined): Partial<ChatState> {
  return value === undefined ? {} : { [key]: value };
}

function assertNever(action: never): never {
  throw new Error(`Unhandled chat action: ${JSON.stringify(action)}`);
}
