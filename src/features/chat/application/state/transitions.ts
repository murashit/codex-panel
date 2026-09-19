import { unchangedCollaborationModeIntent } from "../../domain/runtime/intent";
import { initialActiveChatRuntimeState, initialChatRuntimeState } from "../../domain/runtime/state";
import { turnOutcomeLabel } from "../../domain/runtime/turn-outcome";
import { initialChatRequestState, resolveChatRequest } from "../pending-requests/state";
import type { ForkReplacement } from "../threads/fork-draft";
import { STATUS_TURN_RUNNING, transitionChatTurnLifecycleState } from "../turns/turn-state";
import { initialComposerState } from "./composer";
import {
  activeThreadState,
  type ChatPanelThreadState,
  type ChatState,
  createActiveThreadState,
  createAwaitingResumeThreadState,
  initialPanelThreadState,
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
  PendingStartHookUpsertedAction,
  RequestResolvedAction,
  TurnCompletedAction,
  TurnOptimisticStartedAction,
  TurnStartAcknowledgedAction,
  TurnStartedAction,
  TurnStartFailedAction,
} from "./transition-actions";
import {
  activeTurnCleared,
  activeTurnOptimisticallyStarted,
  activeTurnStartedWithItems,
  activeTurnStartedWithoutItems,
  activeTurnWithLifecycle,
  chatThreadStreamViewState,
  reduceTurnScope,
} from "./turn-scope";
import { clearAllRequestDisclosures, clearResolvedRequestDisclosures, initialUiState } from "./ui";

export function reduceChatTransition(state: ChatState, action: ChatTransitionAction): ChatState {
  switch (action.type) {
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
        connection: { ...state.connection, statusText: "Fork draft. Send a message to create the thread." },
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
  const creatingFork = action.type === "active-thread/created" && state.panelThread.kind === "fork-draft";
  const replacement = creatingFork || panelThreadId(state) === action.thread.id ? pendingForkReplacement(state) : undefined;
  const runtimeBase = action.preserveRequestedRuntimeSettings ? state.runtime : initialChatRuntimeState();
  const turnScopedState = clearTurnScopedState(state);
  const nextPanelTargetRevision = panelThreadId(state) === action.thread.id ? state.panelTargetRevision : state.panelTargetRevision + 1;
  return patchObject(turnScopedState, {
    connection: {
      ...state.connection,
      statusText: action.status ?? state.connection.statusText,
    },
    panelThread: {
      kind: "active",
      ...(replacement ? { forkReplacement: replacement } : {}),
      thread: {
        id: action.thread.id,
        title: (action.thread.name ?? action.thread.preview) || null,
        tokenUsage: null,
        lifetime: action.lifetime ?? { kind: "persistent" },
        canAcceptDirectInput: action.canAcceptDirectInput,
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
    threadStream: {
      ...initialChatThreadStreamState(creatingFork ? state.threadStream.stableItems : (action.items ?? [])),
      ...(creatingFork ? { turnDiffs: state.threadStream.turnDiffs } : {}),
    },
    pendingSubmission:
      action.preservePendingSubmissionId && state.pendingSubmission?.id === action.preservePendingSubmissionId
        ? { ...state.pendingSubmission, targetThreadId: action.thread.id }
        : null,
    requests: initialChatRequestState(),
    composer: creatingFork || panelThreadId(state) === action.thread.id ? state.composer : initialComposerState(),
    ui: action.preserveGoalEditor ? { ...initialUiState(), goalEditor: state.ui.goalEditor } : initialUiState(),
  });
}

function reduceActiveThreadSettingsAppliedTransition(state: ChatState, action: ActiveThreadSettingsAppliedAction): ChatState {
  if (!activeThreadState(state)) return state;
  return patchObject(state, {
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
  const activeThread =
    activeThreadState(state) ?? (state.activeTurn.lifecycle.kind === "starting" ? createActiveThreadState(action.threadId) : null);
  if (!activeThread || activeThread.id !== action.threadId) return state;
  const stream = action.items
    ? activeTurnStartedWithItems(state.activeTurn, state.threadStream, action.turnId, action.items)
    : activeTurnStartedWithoutItems(state.activeTurn, state.threadStream, action.turnId);
  return patchObject(state, {
    panelThread: { kind: "active", thread: activeThread },
    panelTargetRevision: panelThreadId(state) === action.threadId ? state.panelTargetRevision : state.panelTargetRevision + 1,
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
    pendingTurnStart: action.pendingTurnStart,
  });
  const stream = activeTurnOptimisticallyStarted(state.activeTurn, state.threadStream, action.item);
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    pendingSubmission: action.pendingSubmissionId ? null : state.pendingSubmission,
    threadStream: stream.threadStream,
  });
}

function reduceTurnStartAcknowledgedTransition(state: ChatState, action: TurnStartAcknowledgedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, {
    type: "start-acknowledged",
    turnId: action.turnId,
  });
  if (lifecycle === state.activeTurn.lifecycle) return state;
  const stream = activeTurnStartedWithItems(state.activeTurn, state.threadStream, action.turnId, action.items);
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    threadStream: stream.threadStream,
  });
}

function reduceTurnStartFailedTransition(state: ChatState, action: TurnStartFailedAction): ChatState {
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, { type: "start-failed" });
  if (lifecycle === state.activeTurn.lifecycle) return state;
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(state.activeTurn, lifecycle),
    threadStream: threadStreamWithItems(state.threadStream, action.items),
  });
}

function reducePendingStartHookUpsertedTransition(state: ChatState, action: PendingStartHookUpsertedAction): ChatState {
  const stream = reduceTurnScope(state.activeTurn, state.threadStream, { type: "thread-stream/item-upserted", item: action.item });
  const lifecycle = transitionChatTurnLifecycleState(state.activeTurn.lifecycle, {
    type: "pending-start-hook-upserted",
    pendingTurnStart: action.pendingTurnStart,
  });
  return patchObject(state, {
    activeTurn: activeTurnWithLifecycle(stream.activeTurn, lifecycle),
    threadStream: stream.threadStream,
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
    activeTurn: activeTurnCleared(state.activeTurn),
    threadStream: threadStreamWithItems(state.threadStream, items),
    requests: initialChatRequestState(),
    ui: clearAllRequestDisclosures(state.ui),
  });
}

function clearThreadScopedState(state: ChatState): ChatState {
  const cleared = clearTurnScopedState(state);
  return patchObject(cleared, {
    panelThread: initialPanelThreadState(),
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
  if (panelThread.kind === "awaiting-resume" || panelThread.kind === "fork-draft") return panelThread;
  if (panelThread.kind !== "active" || panelThread.thread.lifetime?.kind === "ephemeral") return initialPanelThreadState();
  return {
    ...createAwaitingResumeThreadState(panelThread.thread.id, panelThread.thread.title ?? null, panelThread.thread.provenance),
    ...(panelThread.forkReplacement ? { forkReplacement: panelThread.forkReplacement } : {}),
  };
}
