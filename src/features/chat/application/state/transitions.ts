import { threadMeaningfulTitle } from "../../../../domain/threads/title";
import { type ActiveThreadRuntimeState, initialChatRuntimeState } from "../../domain/runtime/state";
import { turnOutcomeLabel } from "../../domain/runtime/turn-outcome";
import { initialChatRequestState, resolveChatRequest } from "../pending-requests/state";
import type { ForkReplacement } from "../threads/fork-draft";
import { STATUS_TURN_RUNNING, transitionChatTurnLifecycleState } from "../turns/turn-state";
import { initialComposerState } from "./composer";
import {
  activeThreadState,
  type ChatPanelThreadState,
  type ChatState,
  createAwaitingResumeThreadState,
  initialPanelThreadState,
  newConversationEphemeral,
  panelThreadId,
  panelThreadIdForState,
  pendingForkReplacement,
} from "./model";
import { patchObject } from "./patch";
import { initialChatThreadStreamState, threadStreamItems, threadStreamWithItems } from "./thread-stream";
import type {
  ActiveThreadCreatedAction,
  ActiveThreadResumedAction,
  ActiveThreadSettingsAppliedAction,
  ChatTransitionAction,
  RequestResolvedAction,
  TurnCompletedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartedAction,
  TurnStartFailedAction,
} from "./transition-actions";
import {
  activeTurnOptimisticallyStarted,
  activeTurnStarted,
  activeTurnWithLifecycle,
  chatThreadStreamViewState,
  initialChatActiveTurnState,
  reduceTurnScope,
} from "./turn-scope";
import { clearAllRequestDisclosures, clearResolvedRequestDisclosures, initialUiState } from "./ui";

export function reduceChatTransition(state: ChatState, action: ChatTransitionAction): ChatState {
  switch (action.type) {
    case "panel/ephemeral-default-set":
      return patchObject(state, { newConversationEphemeralDefault: action.ephemeral });
    case "panel/ephemeral-choice-set":
      if (state.panelThread.kind !== "empty" || state.panelThread.operation) return state;
      return { ...state, panelThread: { ...state.panelThread, ephemeral: action.ephemeral } };
    case "panel/creation-state-set": {
      if (state.panelThread.kind !== "empty" || state.panelTargetRevision !== action.revision) return state;
      const panel = { ...state.panelThread };
      delete panel.operation;
      return {
        ...state,
        panelThread: { ...panel, ephemeral: newConversationEphemeral(state), ...(action.operation ? { operation: action.operation } : {}) },
      };
    }
    case "active-thread/renamed": {
      if (state.panelThread.kind !== "active" || state.panelThread.thread.id !== action.threadId) return state;
      const thread = state.panelThread.thread;
      return { ...state, panelThread: { ...state.panelThread, thread: { ...thread, name: action.name } } };
    }
    case "panel/fork-operation-set": {
      if (state.panelThread.kind !== "fork-draft" || state.panelTargetRevision !== action.revision) return state;
      const panel = { ...state.panelThread };
      delete panel.operation;
      return { ...state, panelThread: { ...panel, ...(action.operation ? { operation: action.operation } : {}) } };
    }
    case "panel/fork-draft-applied": {
      const { draft, display } = action.preparation;
      return {
        ...clearThreadScopedState(state),
        panelThread: { kind: "fork-draft", draft },
        panelTargetRevision: state.panelTargetRevision + 1,
        runtime: action.preparation.runtime,
        threadStream: {
          ...initialChatThreadStreamState(display.items),
          turnDiffs: display.turnDiffs,
          historyCursor: display.historyCursor ?? null,
        },
        composer: { ...initialComposerState(), draft: draft.initialPrompt ?? "" },
        connection: {
          ...state.connection,
          statusText:
            draft.kind === "side-chat" ? "Side chat draft. Send a message to begin." : "Fork draft. Send a message to create the thread.",
        },
      };
    }
    case "active-thread/fork-replacement-settled": {
      const panelThread = state.panelThread;
      if ((panelThread.kind !== "active" && panelThread.kind !== "awaiting-resume") || panelThreadId(state) !== action.threadId)
        return state;
      const settled = { ...panelThread };
      delete settled.forkReplacement;
      return { ...state, panelThread: settled };
    }
    case "connection/scoped-cleared":
      return clearConnectionScopedState(state);
    case "active-thread/cleared":
      if (action.expectedPanelTargetRevision !== undefined && action.expectedPanelTargetRevision !== state.panelTargetRevision) {
        return state;
      }
      return clearThreadScopedState(state);
    case "active-thread/created":
    case "active-thread/resumed":
      return reduceActiveThreadActivatedTransition(state, action);
    case "active-thread/settings-applied":
      return reduceActiveThreadSettingsAppliedTransition(state, action);
    case "panel/restored-thread-applied":
      return reduceRestoredThreadAppliedTransition(state, action.threadId, action.fallbackTitle, action.forkReplacement);
    case "panel/restored-thread-renamed":
      return reduceRestoredThreadRenamedTransition(state, action.threadId, action.name);
    case "panel/view-state-cleared":
      return reduceViewStateClearedTransition(state);
    case "panel/disposed":
      return { ...state, panelTargetRevision: state.panelTargetRevision + 1 };
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
    case "request/resolved":
      return reduceRequestResolvedTransition(state, action);
    case "web-submission/pending":
      return patchObject(state, { pendingSubmission: action.submission });
    case "web-submission/committed":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "cancellable"
        ? patchObject(state, { pendingSubmission: { ...state.pendingSubmission, phase: "committed" } })
        : state;
    case "web-submission/cancelled":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "cancellable"
        ? patchObject(state, { pendingSubmission: null })
        : state;
    case "web-submission/failed":
      return state.pendingSubmission?.id === action.submissionId && state.pendingSubmission.phase === "committed"
        ? patchObject(state, { pendingSubmission: null })
        : state;
    case "web-submission/steer-pending": {
      if (state.pendingSubmission?.id !== action.submissionId || state.pendingSubmission.phase !== "committed") return state;
      const stream = reduceTurnScope(state.activeTurn, state.threadStream, {
        type: "thread-stream/pending-steer-added",
        item: action.item,
      });
      return patchObject(state, {
        pendingSubmission: null,
        activeTurn: stream.activeTurn,
        threadStream: stream.threadStream,
      });
    }
  }
}

function reduceActiveThreadActivatedTransition(state: ChatState, action: ActiveThreadResumedAction | ActiveThreadCreatedAction): ChatState {
  if (action.expectedPanelTargetRevision !== undefined && action.expectedPanelTargetRevision !== state.panelTargetRevision) {
    return state;
  }
  const creating =
    action.type === "active-thread/created" && (state.panelThread.kind === "empty" || state.panelThread.kind === "fork-draft");
  const creatingFork = creating && state.panelThread.kind === "fork-draft";
  const sameConversation = creating || panelThreadId(state) === action.thread.id;
  const replacement = creatingFork || panelThreadId(state) === action.thread.id ? pendingForkReplacement(state) : undefined;
  const runtimeBase = action.preserveRequestedRuntimeSettings ? state.runtime : initialChatRuntimeState();
  const turnScopedState = clearTurnScopedState(state);
  const nextPanelTargetRevision = sameConversation ? state.panelTargetRevision : state.panelTargetRevision + 1;
  const threadStream = initialChatThreadStreamState(creatingFork ? state.threadStream.stableItems : (action.items ?? []));
  const restoredTurn = action.activeTurnId
    ? activeTurnStarted(
        activeTurnWithLifecycle(initialChatActiveTurnState(), { kind: "running", turnId: action.activeTurnId }),
        threadStream,
        action.activeTurnId,
      )
    : { activeTurn: initialChatActiveTurnState(), threadStream };
  return patchObject(turnScopedState, {
    connection: {
      ...state.connection,
      statusText: action.activeTurnId ? STATUS_TURN_RUNNING : state.connection.statusText,
    },
    panelThread: {
      kind: "active",
      ...(replacement ? { forkReplacement: replacement } : {}),
      thread: {
        id: action.thread.id,
        name: action.thread.name,
        preview: action.thread.preview,
        tokenUsage: null,
        lifetime: action.lifetime ?? { kind: "persistent" },
        canAcceptDirectInput: action.canAcceptDirectInput,
        provenance: action.thread.provenance,
      },
    },
    panelTargetRevision: nextPanelTargetRevision,
    threadReadReceipt: sameConversation ? state.threadReadReceipt : null,
    runtime: {
      ...runtimeBase,
      active: activeRuntimeFromAction(action),
    },
    threadStream: {
      ...restoredTurn.threadStream,
      ...(creatingFork ? { turnDiffs: state.threadStream.turnDiffs } : {}),
    },
    activeTurn: restoredTurn.activeTurn,
    pendingSubmission: creating && state.pendingSubmission ? { ...state.pendingSubmission, targetThreadId: action.thread.id } : null,
    requests: initialChatRequestState(),
    composer: sameConversation ? state.composer : initialComposerState(),
    ui: action.preserveGoalEditor ? { ...initialUiState(), goalEditor: state.ui.goalEditor } : initialUiState(),
  });
}

function reduceActiveThreadSettingsAppliedTransition(state: ChatState, action: ActiveThreadSettingsAppliedAction): ChatState {
  if (!activeThreadState(state)) return state;
  return patchObject(state, {
    runtime: {
      ...state.runtime,
      active: activeRuntimeFromAction(action),
    },
  });
}

function reduceRestoredThreadAppliedTransition(
  state: ChatState,
  threadId: string,
  fallbackTitle: string | null,
  forkReplacement?: ForkReplacement,
): ChatState {
  const cleared = clearThreadScopedState(state);
  return patchObject(cleared, {
    connection: { ...cleared.connection, statusText: "Thread ready to resume." },
    panelThread: { ...createAwaitingResumeThreadState(threadId, fallbackTitle), ...(forkReplacement ? { forkReplacement } : {}) },
  });
}

function reduceRestoredThreadRenamedTransition(state: ChatState, threadId: string, name: string | null): ChatState {
  if (state.panelThread.kind !== "awaiting-resume" || state.panelThread.threadId !== threadId) return state;
  return patchObject(state, { panelThread: { ...state.panelThread, fallbackTitle: name } });
}

function reduceViewStateClearedTransition(state: ChatState): ChatState {
  const cleared = clearThreadScopedState(state);
  return patchObject(cleared, { connection: { ...cleared.connection, statusText: "Idle" } });
}

function reduceTurnStartedTransition(state: ChatState, action: TurnStartedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, { type: "started", turnId: action.turnId });
  if (lifecycle === state.activeTurn.lifecycle) return state;
  const activeThread = activeThreadState(state);
  if (!activeThread || activeThread.id !== action.threadId) return state;
  const stream = activeTurnStarted(state.activeTurn, state.threadStream, action.turnId);
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    connection: { ...state.connection, statusText: STATUS_TURN_RUNNING },
    threadStream: stream.threadStream,
  });
}

function reduceTurnCompletedTransition(state: ChatState, action: TurnCompletedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, { type: "completed", turnId: action.turnId });
  if (lifecycle === state.activeTurn.lifecycle) return state;
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(state.activeTurn, lifecycle),
    threadStream: threadStreamWithItems(state.threadStream, action.items),
    connection: { ...state.connection, statusText: turnOutcomeLabel(action.outcome) },
  });
}

function reduceTurnOptimisticStartedTransition(state: ChatState, action: TurnOptimisticStartedAction): ChatState {
  if (
    action.pendingSubmissionId &&
    (state.pendingSubmission?.id !== action.pendingSubmissionId || state.pendingSubmission.phase !== "committed")
  ) {
    return state;
  }
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, {
    type: "optimistic-started",
    anchorItemId: action.item.id,
  });
  const stream = activeTurnOptimisticallyStarted(state.activeTurn, state.threadStream, action.item);
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    pendingSubmission: action.pendingSubmissionId ? null : state.pendingSubmission,
    threadStream: stream.threadStream,
  });
}

function reduceTurnStartAcknowledgedTransition(state: ChatState, action: TurnStartAcknowledgedAction): ChatState {
  if (panelThreadId(state) !== action.threadId) return state;
  const current = state.activeTurn.lifecycle;
  if (current.kind === "starting" && current.anchorItemId !== action.anchorItemId) return state;
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, {
    type: "start-acknowledged",
    turnId: action.turnId,
  });
  if (lifecycle === state.activeTurn.lifecycle) return state;
  const items = threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)).map((item) =>
    item.id === action.anchorItemId ? { ...item, turnId: action.turnId } : item,
  );
  const stream = activeTurnStarted(state.activeTurn, state.threadStream, action.turnId, items);
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    threadStream: stream.threadStream,
    connection: { ...state.connection, statusText: STATUS_TURN_RUNNING },
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const current = state.activeTurn.lifecycle;
  if (panelThreadId(state) !== action.threadId || current.kind !== "starting" || current.anchorItemId !== action.anchorItemId) return state;
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, { type: "start-failed" });
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(state.activeTurn, lifecycle),
    threadStream: threadStreamWithItems(
      state.threadStream,
      threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)).filter((item) => item.id !== action.anchorItemId),
    ),
  });
}

function reduceRequestResolvedTransition(state: ChatState, action: RequestResolvedAction): ChatState {
  const requests = resolveChatRequest(state.requests, action.requestId);
  if (requests === state.requests) return state;
  const stream = action.resultItem
    ? reduceTurnScope(state.activeTurn, state.threadStream, { type: "thread-stream/item-added", item: action.resultItem })
    : { activeTurn: state.activeTurn, threadStream: state.threadStream };
  return patchObject(state, {
    requests,
    ui: clearResolvedRequestDisclosures(state.ui, action.requestId),
    activeTurn: stream.activeTurn,
    threadStream: stream.threadStream,
  });
}

function clearTurnScopedState(state: ChatState): ChatState {
  const items = threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn));
  return patchObject(state, {
    activeTurn: initialChatActiveTurnState(),
    threadStream: threadStreamWithItems(state.threadStream, items),
    requests: initialChatRequestState(),
    ui: clearAllRequestDisclosures(state.ui),
  });
}

function clearThreadScopedState(state: ChatState): ChatState {
  const cleared = clearTurnScopedState(state);
  return patchObject(cleared, {
    panelThread: initialPanelThreadState(),
    threadReadReceipt: null,
    panelTargetRevision: state.panelTargetRevision + 1,
    runtime: initialChatRuntimeState(),
    threadStream: initialChatThreadStreamState(),
    pendingSubmission: null,
    composer: initialComposerState(),
    ui: initialUiState(),
  });
}

function clearConnectionScopedState(state: ChatState): ChatState {
  const cleared = clearTurnScopedState(state);
  const ephemeralExpired = state.panelThread.kind === "active" && state.panelThread.thread.lifetime?.kind === "ephemeral";
  const nextPanelThread = panelThreadAfterConnectionExit(state.panelThread);
  return patchObject(cleared, {
    panelThread: nextPanelThread,
    panelTargetRevision:
      panelThreadIdForState(nextPanelThread) === panelThreadId(state) ? state.panelTargetRevision : state.panelTargetRevision + 1,
    runtime: state.panelThread.kind === "fork-draft" ? state.runtime : initialChatRuntimeState(),
    threadStream: ephemeralExpired ? initialChatThreadStreamState() : cleared.threadStream,
    pendingSubmission: null,
    composer: state.composer,
  });
}

function panelThreadAfterConnectionExit(panelThread: ChatPanelThreadState): ChatPanelThreadState {
  if (panelThread.kind === "awaiting-resume" || panelThread.kind === "fork-draft" || panelThread.kind === "empty") return panelThread;
  if (panelThread.thread.lifetime?.kind === "ephemeral") return initialPanelThreadState();
  return {
    ...createAwaitingResumeThreadState(panelThread.thread.id, threadMeaningfulTitle(panelThread.thread), panelThread.thread.provenance),
    ...(panelThread.forkReplacement ? { forkReplacement: panelThread.forkReplacement } : {}),
  };
}

function activeRuntimeFromAction(
  action: ActiveThreadResumedAction | ActiveThreadCreatedAction | ActiveThreadSettingsAppliedAction,
): ActiveThreadRuntimeState {
  return {
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
  };
}
