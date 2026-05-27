import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ModeKind } from "../../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { ApprovalsReviewer } from "../../generated/app-server/v2/ApprovalsReviewer";
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
import { reportedServiceTier, type ReportedServiceTier, type ServiceTier } from "../../app-server/service-tier";
import { defaultRuntimeOverride, resetRuntimeOverride, setRuntimeOverride, type RuntimeOverride } from "../../runtime/state";

export interface PendingTurnStart {
  anchorItemId: string;
  promptSubmitHookItemIds: string[];
}

export interface ChatState {
  status: string;
  effectiveConfig: ConfigReadResponse | null;
  initializeResponse: InitializeResponse | null;
  activeThreadId: string | null;
  activeThreadCwd: string | null;
  activeTurnId: string | null;
  activeModel: string | null;
  activeReasoningEffort: ReasoningEffort | null;
  activeCollaborationMode: ModeKind;
  activeServiceTier: ReportedServiceTier | null;
  activeApprovalsReviewer: ApprovalsReviewer | null;
  activeThreadCreationCliVersion: string | null;
  appServerDiagnostics: AppServerDiagnostics;
  requestedModel: RuntimeOverride<string>;
  requestedReasoningEffort: RuntimeOverride<ReasoningEffort>;
  requestedApprovalsReviewer: ApprovalsReviewer | null;
  requestedCollaborationMode: ModeKind;
  requestedServiceTier: ServiceTier | null;
  tokenUsage: ThreadTokenUsage | null;
  rateLimit: RateLimitSnapshot | null;
  busy: boolean;
  displayItems: DisplayItem[];
  pendingTurnStart: PendingTurnStart | null;
  turnDiffs: Map<string, string>;
  approvals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  userInputDrafts: Map<string, string>;
  listedThreads: Thread[];
  threadsLoaded: boolean;
  historyCursor: string | null;
  loadingHistory: boolean;
  composerDraft: string;
  runtimePicker: "model" | "effort" | null;
  availableModels: Model[];
  availableSkills: SkillMetadata[];
  reportedLogs: Set<string>;
  composerSuggestSelected: number;
  composerSuggestions: ComposerSuggestion[];
  composerSuggestionsDismissedSignature: string | null;
  messagesPinnedToBottom: boolean;
  openDetails: Set<string>;
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
      serviceTier: ReportedServiceTier | null;
      approvalsReviewer: ApprovalsReviewer | null;
      displayItems?: DisplayItem[];
      status?: string;
      listedThreads?: Thread[];
      forceMessagesToBottom?: boolean;
    }
  | {
      type: "thread/list-applied";
      threads?: Thread[];
      threadsLoaded?: boolean;
      effectiveConfig?: ConfigReadResponse | null;
      availableModels?: Model[];
      availableSkills?: SkillMetadata[];
      rateLimit?: RateLimitSnapshot | null;
      appServerDiagnostics?: AppServerDiagnostics;
    }
  | {
      type: "turn/started";
      threadId: string;
      turnId: string;
      displayItems?: DisplayItem[];
      pendingTurnStart?: PendingTurnStart | null;
    }
  | { type: "turn/completed"; turnId: string; status: string; displayItems: DisplayItem[] }
  | { type: "request/approval-queued"; approval: PendingApproval }
  | { type: "request/user-input-queued"; input: PendingUserInput }
  | { type: "request/resolved"; requestId: PendingApproval["requestId"]; resultItem?: DisplayItem }
  | {
      type: "display/items-replaced";
      items: DisplayItem[];
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
      suggestions: ComposerSuggestion[];
      selected?: number;
      dismissedSignature?: string | null;
    }
  | {
      type: "ui/panel-set";
      panel: "history" | "status-panel" | "model" | "effort" | null;
      toggle?: boolean;
    }
  | { type: "ui/messages-pinned-set"; pinned: boolean }
  | { type: "ui/detail-open-set"; key: string; open: boolean }
  | { type: "request/user-input-draft-set"; key: string; value: string }
  | { type: "runtime/requested-model-set"; model: string | null }
  | { type: "runtime/requested-effort-set"; effort: ReasoningEffort | null }
  | { type: "runtime/requested-service-tier-set"; serviceTier: ServiceTier | null; activate?: boolean }
  | { type: "runtime/requested-approvals-reviewer-set"; approvalsReviewer: ApprovalsReviewer | null; activate?: boolean }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: ModeKind }
  | { type: "runtime/pending-thread-settings-committed"; update: Omit<ThreadSettingsUpdateParams, "threadId"> }
  | { type: "state/patched"; patch: Partial<ChatState> };

export function createChatState(): ChatState {
  return {
    status: "Idle",
    effectiveConfig: null,
    initializeResponse: null,
    activeThreadId: null,
    activeThreadCwd: null,
    activeTurnId: null,
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalsReviewer: null,
    activeThreadCreationCliVersion: null,
    appServerDiagnostics: createAppServerDiagnostics(),
    requestedModel: defaultRuntimeOverride(),
    requestedReasoningEffort: defaultRuntimeOverride(),
    requestedApprovalsReviewer: null,
    requestedCollaborationMode: "default",
    requestedServiceTier: null,
    tokenUsage: null,
    rateLimit: null,
    busy: false,
    displayItems: [],
    pendingTurnStart: null,
    turnDiffs: new Map(),
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
    listedThreads: [],
    threadsLoaded: false,
    historyCursor: null,
    loadingHistory: false,
    composerDraft: "",
    runtimePicker: null,
    availableModels: [],
    availableSkills: [],
    reportedLogs: new Set(),
    composerSuggestSelected: 0,
    composerSuggestions: [],
    composerSuggestionsDismissedSignature: null,
    messagesPinnedToBottom: true,
    openDetails: new Set(),
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
    case "status/set":
      return patchChatState(state, { status: action.status });
    case "system/message-added":
      return patchChatState(state, { displayItems: [...state.displayItems, action.item] });
    case "system/deduped-log-added":
      if (state.reportedLogs.has(action.text)) return state;
      return patchChatState(state, {
        reportedLogs: new Set([...state.reportedLogs, action.text]),
        displayItems: [...state.displayItems, action.item],
      });
    case "connection/scoped-cleared":
      return clearConnectionScopedState(state);
    case "thread/active-cleared":
      return clearActiveThreadState(state);
    case "thread/resumed":
      return patchChatState(state, {
        activeThreadId: action.thread.id,
        activeThreadCwd: action.cwd,
        activeTurnId: null,
        activeModel: action.model,
        activeReasoningEffort: action.reasoningEffort,
        activeServiceTier: action.serviceTier,
        activeApprovalsReviewer: action.approvalsReviewer,
        activeThreadCreationCliVersion: action.thread.cliVersion,
        tokenUsage: null,
        historyCursor: null,
        turnDiffs: new Map(),
        displayItems: action.displayItems ?? state.displayItems,
        listedThreads: action.listedThreads ?? state.listedThreads,
        messagesPinnedToBottom: action.forceMessagesToBottom ?? state.messagesPinnedToBottom,
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
    case "turn/started":
      return patchChatState(state, {
        activeThreadId: action.threadId,
        activeTurnId: action.turnId,
        busy: true,
        status: "Turn running...",
        displayItems: action.displayItems ?? state.displayItems,
        pendingTurnStart: action.pendingTurnStart === undefined ? state.pendingTurnStart : action.pendingTurnStart,
      });
    case "turn/completed":
      return patchChatState(state, {
        displayItems: action.displayItems,
        busy: false,
        activeTurnId: null,
        status: `Turn ${action.status}.`,
      });
    case "request/approval-queued":
      if (state.approvals.some((existing) => existing.requestId === action.approval.requestId)) return state;
      return patchChatState(state, { approvals: [...state.approvals, action.approval] });
    case "request/user-input-queued":
      if (state.pendingUserInputs.some((existing) => existing.requestId === action.input.requestId)) return state;
      return patchChatState(state, { pendingUserInputs: [...state.pendingUserInputs, action.input] });
    case "request/resolved":
      return resolveRequest(state, action.requestId, action.resultItem);
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
    case "ui/panel-set":
      return setPanelState(state, action.panel, action.toggle ?? false);
    case "ui/messages-pinned-set":
      return patchChatState(state, { messagesPinnedToBottom: action.pinned });
    case "ui/detail-open-set":
      return setDetailOpenState(state, action.key, action.open);
    case "request/user-input-draft-set":
      return setUserInputDraftState(state, action.key, action.value);
    case "runtime/requested-model-set":
      return patchChatState(state, { requestedModel: action.model === null ? resetRuntimeOverride() : setRuntimeOverride(action.model) });
    case "runtime/requested-effort-set":
      return patchChatState(state, {
        requestedReasoningEffort: action.effort === null ? resetRuntimeOverride() : setRuntimeOverride(action.effort),
      });
    case "runtime/requested-service-tier-set":
      return patchChatState(state, {
        requestedServiceTier: action.serviceTier,
        ...(action.activate ? { activeServiceTier: action.serviceTier } : {}),
      });
    case "runtime/requested-approvals-reviewer-set":
      return patchChatState(state, {
        requestedApprovalsReviewer: action.approvalsReviewer,
        ...(action.activate ? { activeApprovalsReviewer: action.approvalsReviewer } : {}),
      });
    case "runtime/requested-collaboration-mode-set":
      return patchChatState(state, { requestedCollaborationMode: action.collaborationMode });
    case "runtime/pending-thread-settings-committed":
      return commitPendingThreadSettings(state, action.update);
    case "state/patched":
      return patchChatState(state, action.patch);
  }
}

export function clearActiveTurnState(state: ChatState): ChatState {
  return patchChatState(state, {
    activeTurnId: null,
    busy: false,
    pendingTurnStart: null,
    approvals: [],
    pendingUserInputs: [],
    userInputDrafts: new Map(),
  });
}

export function clearActiveThreadState(state: ChatState): ChatState {
  return clearActiveTurnState(
    patchChatState(state, {
      activeThreadId: null,
      activeThreadCwd: null,
      activeModel: null,
      activeReasoningEffort: null,
      activeCollaborationMode: "default",
      activeServiceTier: null,
      activeApprovalsReviewer: null,
      activeThreadCreationCliVersion: null,
      tokenUsage: null,
      historyCursor: null,
      loadingHistory: false,
      displayItems: [],
      turnDiffs: new Map(),
      messagesPinnedToBottom: true,
    }),
  );
}

export function clearConnectionScopedState(state: ChatState): ChatState {
  return patchChatState(clearActiveTurnState(state), {
    activeModel: null,
    activeReasoningEffort: null,
    activeCollaborationMode: "default",
    activeServiceTier: null,
    activeApprovalsReviewer: null,
    activeThreadCreationCliVersion: null,
    rateLimit: null,
    listedThreads: [],
    threadsLoaded: false,
    availableModels: [],
    availableSkills: [],
    appServerDiagnostics: createAppServerDiagnostics(),
    runtimePicker: null,
  });
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

function updatedTurnDiffs(turnDiffs: Map<string, string>, turnId: string, diff: string): Map<string, string> {
  const next = new Map(turnDiffs);
  if (diff.trim().length > 0) {
    next.set(turnId, diff);
  } else {
    next.delete(turnId);
  }
  return next;
}

function setPanelState(state: ChatState, panel: "history" | "status-panel" | "model" | "effort" | null, toggle: boolean): ChatState {
  const currentPanel = state.openDetails.has("history")
    ? "history"
    : state.openDetails.has("status-panel")
      ? "status-panel"
      : state.runtimePicker;
  const nextPanel = toggle && currentPanel === panel ? null : panel;
  return patchChatState(state, {
    openDetails:
      nextPanel === "history" || nextPanel === "status-panel"
        ? new Set([nextPanel])
        : new Set([...state.openDetails].filter((key) => key !== "history" && key !== "status-panel")),
    runtimePicker: nextPanel === "model" || nextPanel === "effort" ? nextPanel : null,
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
    ...("model" in update ? { activeModel: update.model ?? null, requestedModel: defaultRuntimeOverride<string>() } : {}),
    ...("effort" in update
      ? { activeReasoningEffort: update.effort ?? null, requestedReasoningEffort: defaultRuntimeOverride<ReasoningEffort>() }
      : {}),
    ...("serviceTier" in update
      ? { activeServiceTier: state.requestedServiceTier ?? reportedServiceTier(update.serviceTier), requestedServiceTier: null }
      : {}),
    ...("approvalsReviewer" in update
      ? { activeApprovalsReviewer: update.approvalsReviewer ?? null, requestedApprovalsReviewer: null }
      : {}),
    ...(update.collaborationMode ? { activeCollaborationMode: update.collaborationMode.mode } : {}),
  });
}

function setComposerSuggestionsState(
  state: ChatState,
  suggestions: ComposerSuggestion[],
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

function composerSuggestionsEqual(left: ComposerSuggestion[], right: ComposerSuggestion[]): boolean {
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
