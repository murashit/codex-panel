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
import type { CollaborationModeSelection } from "../../domain/runtime/intent";
import {
  commitAppliedRuntimeSettingsPatchState,
  clearRequestedApprovalsReviewerRuntimeState,
  clearRequestedFastModeRuntimeState,
  initialActiveChatRuntimeState,
  initialChatRuntimeState,
  requestApprovalsReviewerRuntimeState,
  requestModelRuntimeState,
  requestReasoningEffortRuntimeState,
  requestFastModeRuntimeState,
  resetModelToConfigRuntimeState,
  resetReasoningEffortToConfigRuntimeState,
  setSelectedCollaborationModeRuntimeState,
  type ChatRuntimeState,
} from "../../domain/runtime/state";
import type { RequestedFastMode } from "../../domain/runtime/intent";
import type { PendingRequestId } from "../../../../domain/pending-requests/model";
import type { ComposerSuggestion } from "../composer/suggestions";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type {
  ActiveThreadResumedAction,
  ActiveThreadSettingsAppliedAction,
  ClearActiveThreadAction,
  ClearDisconnectedConnectionStateAction,
  ClearLocalTurnAction,
  ConnectionInitializedAction,
  ThreadListAppliedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartFailedAction,
} from "./actions";
import {
  initialChatMessageStreamState,
  isMessageStreamAction,
  messageStreamItems,
  messageStreamStartActiveSegment,
  messageStreamWithActiveTurnItems,
  messageStreamWithItems,
  reduceMessageStreamSlice,
  type ChatMessageStreamState,
  type MessageStreamAction,
} from "./message-stream";
import {
  initialChatRequestState,
  isRequestAction,
  reduceRequestSlice,
  resolveChatRequest,
  type ChatRequestState,
  type RequestAction,
} from "../pending-requests/state";
import {
  STATUS_TURN_RUNNING,
  initialChatTurnState,
  transitionChatTurnLifecycleState,
  type ChatTurnState,
  type PendingTurnStart,
} from "../conversation/turn-state";
import {
  clearAllRequestDisclosures,
  clearResolvedRequestDisclosures,
  initialUiState,
  isUiAction,
  maybeClearGoalObjectiveExpansion,
  reduceUiSlice,
  type ChatUiState,
  type UiAction,
} from "./ui-state";
import { definedPatch, patchObject } from "./patch";

export type ChatConnectionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string }
  | { kind: "disconnected"; message: string };

function turnCompletedStatus(status: string): string {
  return `Turn ${status}.`;
}

interface ChatConnectionState {
  readonly phase: ChatConnectionPhase;
  readonly statusText: string;
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly initializeResponse: ServerInitialization | null;
  readonly rateLimit: RateLimitSnapshot | null;
  readonly serverDiagnostics: Diagnostics;
  readonly availableModels: readonly ModelMetadata[];
  readonly availableSkills: readonly SkillMetadata[];
}

interface ChatThreadListState {
  readonly listedThreads: readonly Thread[];
  readonly threadsLoaded: boolean;
}

export interface ChatActiveThreadState {
  readonly id: string | null;
  readonly cwd: string | null;
  readonly goal: ThreadGoal | null;
  readonly tokenUsage: ThreadTokenUsage | null;
}

interface ChatComposerState {
  readonly draft: string;
  readonly suggestSelected: number;
  readonly suggestions: readonly ComposerSuggestion[];
  readonly suggestionsDismissedSignature: string | null;
}

export interface ChatState {
  readonly connection: ChatConnectionState;
  readonly threadList: ChatThreadListState;
  readonly activeThread: ChatActiveThreadState;
  readonly runtime: ChatRuntimeState;
  readonly turn: ChatTurnState;
  readonly messageStream: ChatMessageStreamState;
  readonly requests: ChatRequestState;
  readonly composer: ChatComposerState;
  readonly ui: ChatUiState;
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
  | MessageStreamAction
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

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
    case "active-thread/cleared":
    case "active-thread/resumed":
    case "active-thread/settings-applied":
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
      return clearConnectionScopedState(state);
    case "active-thread/cleared":
      return clearThreadScopedState(state);
    case "active-thread/resumed":
      return reduceActiveThreadResumedTransition(state, action);
    case "active-thread/settings-applied":
      return reduceActiveThreadSettingsAppliedTransition(state, action);
    case "active-thread/goal-set":
      return reduceActiveThreadGoalSetTransition(state, action.goal);
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
  }
}

function reduceActiveThreadResumedTransition(state: ChatState, action: ActiveThreadResumedAction): ChatState {
  const runtimeBase = action.preserveRequestedRuntimeSettings ? state.runtime : initialChatRuntimeState();
  const turnScopedState = clearTurnScopedState(state);
  return patchChatState(turnScopedState, {
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
      active: {
        serviceTierKnown: action.serviceTierKnown ?? true,
        model: action.model,
        reasoningEffort: action.reasoningEffort,
        collaborationMode: initialActiveChatRuntimeState().collaborationMode,
        serviceTier: action.serviceTier,
        approvalsReviewer: action.approvalsReviewer,
      },
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
      active: {
        serviceTierKnown: true,
        model: action.model,
        reasoningEffort: action.reasoningEffort,
        collaborationMode: action.collaborationMode,
        serviceTier: action.serviceTier,
        approvalsReviewer: action.approvalsReviewer,
      },
      pending: {
        ...state.runtime.pending,
        collaborationMode: action.collaborationMode,
      },
    },
  });
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

function clearTurnScopedState(state: ChatState): ChatState {
  return patchChatState(state, {
    turn: {
      lifecycle: transitionChatTurnLifecycleState(state.turn.lifecycle, { type: "cleared" }),
    },
    messageStream: messageStreamWithItems(state.messageStream, messageStreamItems(state.messageStream)),
    requests: initialRequestState(),
    ui: clearAllRequestDisclosures(state.ui),
  });
}

function clearThreadScopedState(state: ChatState): ChatState {
  return clearTurnScopedState(
    patchChatState(state, {
      activeThread: initialActiveThreadState(),
      runtime: initialChatRuntimeState(),
      messageStream: initialMessageStreamState(),
      composer: initialComposerState(),
      ui: initialUiState(),
    }),
  );
}

function clearConnectionScopedState(state: ChatState): ChatState {
  return patchChatState(clearTurnScopedState(state), {
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

function patchChatState(state: ChatState, patch: Partial<ChatState>): ChatState {
  return patchObject(state, patch);
}
