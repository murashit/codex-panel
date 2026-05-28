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

export type ChatTurnLifecycleState =
  | { kind: "idle" }
  | { kind: "starting"; pendingTurnStart: PendingTurnStart }
  | { kind: "running"; turnId: string };

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
  runtimePicker: "model" | "effort" | null;
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
      serviceTier: ReportedServiceTier | null;
      approvalsReviewer: ApprovalsReviewer | null;
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
  | { type: "connection/initialized"; initializeResponse: InitializeResponse }
  | { type: "thread/cwd-set"; cwd: string | null }
  | { type: "thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null }
  | {
      type: "thread/settings-applied";
      cwd: string;
      model: string | null;
      reasoningEffort: ReasoningEffort | null;
      collaborationMode: ModeKind;
      serviceTier: ReportedServiceTier | null;
      approvalsReviewer: ApprovalsReviewer | null;
    }
  | { type: "thread/restored-placeholder"; threadId: string; item: DisplayItem }
  | { type: "history/loading-set"; loading: boolean }
  | { type: "turn/local-cleared" }
  | { type: "turn/optimistic-started"; item: DisplayItem; pendingTurnStart: PendingTurnStart }
  | { type: "turn/start-acknowledged"; turnId: string; displayItems: readonly DisplayItem[] }
  | { type: "turn/start-failed"; displayItems: readonly DisplayItem[] }
  | { type: "display/pending-turn-item-upserted"; item: DisplayItem; pendingTurnStart: PendingTurnStart | null };

export function createChatState(): ChatState {
  return {
    status: "Idle",
    effectiveConfig: null,
    initializeResponse: null,
    activeThreadId: null,
    activeThreadCwd: null,
    turnLifecycle: { kind: "idle" },
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
    displayItems: [],
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
        turnLifecycle: { kind: "idle" },
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
        turnLifecycle: { kind: "running", turnId: action.turnId },
        status: "Turn running...",
        displayItems: action.displayItems ?? state.displayItems,
      });
    case "turn/completed":
      if (activeTurnId(state) !== action.turnId) return state;
      return patchChatState(state, {
        turnLifecycle: { kind: "idle" },
        displayItems: action.displayItems,
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
    case "connection/initialized":
      return patchChatState(state, { initializeResponse: action.initializeResponse });
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
        requestedCollaborationMode: action.collaborationMode,
        activeServiceTier: action.serviceTier,
        activeApprovalsReviewer: action.approvalsReviewer,
      });
    case "thread/restored-placeholder":
      return clearActiveTurnState(
        patchChatState(state, {
          activeThreadId: action.threadId,
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
          displayItems: [action.item],
          turnDiffs: new Map(),
          messagesPinnedToBottom: true,
        }),
      );
    case "history/loading-set":
      return patchChatState(state, { loadingHistory: action.loading });
    case "turn/local-cleared":
      return clearActiveTurnState(state);
    case "turn/optimistic-started":
      return patchChatState(state, {
        turnLifecycle: { kind: "starting", pendingTurnStart: action.pendingTurnStart },
        displayItems: [...state.displayItems, action.item],
      });
    case "turn/start-acknowledged":
      if (state.turnLifecycle.kind === "idle") return state;
      if (state.turnLifecycle.kind === "running" && state.turnLifecycle.turnId !== action.turnId) return state;
      return patchChatState(state, {
        turnLifecycle: { kind: "running", turnId: action.turnId },
        displayItems: action.displayItems,
      });
    case "turn/start-failed":
      return patchChatState(state, {
        turnLifecycle: { kind: "idle" },
        displayItems: action.displayItems,
      });
    case "display/pending-turn-item-upserted":
      return patchChatState(state, {
        displayItems: upsertDisplayItem(state.displayItems, action.item),
        turnLifecycle: withPendingTurnStart(state.turnLifecycle, action.pendingTurnStart),
      });
  }
}

export function clearActiveTurnState(state: ChatState): ChatState {
  return patchChatState(state, {
    turnLifecycle: { kind: "idle" },
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

export function chatTurnBusy(state: Pick<ChatState, "turnLifecycle">): boolean {
  return state.turnLifecycle.kind !== "idle";
}

export function activeTurnId(state: Pick<ChatState, "turnLifecycle">): string | null {
  return state.turnLifecycle.kind === "running" ? state.turnLifecycle.turnId : null;
}

export function pendingTurnStart(state: Pick<ChatState, "turnLifecycle">): PendingTurnStart | null {
  return state.turnLifecycle.kind === "starting" ? state.turnLifecycle.pendingTurnStart : null;
}

function withPendingTurnStart(lifecycle: ChatTurnLifecycleState, nextPendingTurnStart: PendingTurnStart | null): ChatTurnLifecycleState {
  if (nextPendingTurnStart) return { kind: "starting", pendingTurnStart: nextPendingTurnStart };
  return lifecycle.kind === "starting" ? { kind: "idle" } : lifecycle;
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
