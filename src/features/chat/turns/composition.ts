import type { ChatAppServerThreadActions } from "../app-server/thread-actions";
import { ChatComposerController } from "../composer/controller";
import { activeTurnId } from "../chat-state";
import type { ChatReconnectActions } from "../session/reconnect-actions";
import { PendingRequestController } from "../requests/pending-request-controller";
import type { ChatRuntimeSettingsActions } from "../runtime/runtime-settings-actions";
import { createComposerSubmissionActions } from "./composer-submission-actions";
import { createPlanImplementationActions } from "./plan-implementation-actions";
import { createSlashCommandActions } from "./slash-command-actions";
import { TurnSubmissionController } from "./turn-submission-controller";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import type { ThreadHistoryController } from "../threads/thread-history-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ChatInboundController } from "../inbound/controller";
import { currentModel } from "../runtime/effective-settings";
import { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatPanelContext } from "../panel/context";

export function createConversationSurfaceControllerGroup(
  context: ChatPanelContext,
  refs: {
    controller: ChatInboundController;
    appServerThreads: ChatAppServerThreadActions;
    runtimeSettings: ChatRuntimeSettingsActions;
    threadActions: ChatThreadActions;
    threadRename: ThreadRenameController;
    reconnectActions: ChatReconnectActions;
    goals: ChatThreadGoalActions;
    history: ThreadHistoryController;
  },
) {
  const { plugin, state, render, runtime, thread, liveState, status, lifecycle, client, scroll } = context;
  const { app, owner, viewId } = context.obsidian;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;
  const { messageScrollIntent } = lifecycle;

  const composerController = new ChatComposerController({
    app,
    stateStore,
    viewId,
    sendShortcut: () => plugin.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => plugin.settings.scrollThreadFromComposerEdges,
    canInterrupt: () =>
      state.getState().turn.lifecycle.kind !== "idle" && Boolean(state.getState().activeThread.id && activeTurnId(state.getState())),
    composerPlaceholder: render.composerPlaceholder,
    composerMeta: render.composerMetaViewModel,
    currentModelForSuggestions: () => currentModel(runtime.runtimeSnapshot()),
    togglePlan: () => void refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void refs.runtimeSettings.toggleFastMode(),
    renderIfDetached: render.now,
    onDraftChange: liveState.refresh,
  });
  const pendingRequests = new PendingRequestController({
    stateStore,
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
    render: render.now,
  });

  const turnSubmission = new TurnSubmissionController({
    stateStore,
    connection: {
      vaultPath: plugin.vaultPath,
      currentClient,
    },
    restoredThread: {
      ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    },
    thread: {
      startThread: (preview) => refs.appServerThreads.startThread(preview),
      notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
      resetThreadTurnPresence: thread.resetTurnPresence,
    },
    runtime: {
      applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    },
    composer: {
      codexInput: (text) => composerController.codexInput(text),
      setDraft: (text, options) => {
        composerController.setDraft(text, options);
      },
    },
    view: {
      render: render.now,
      scheduleRender: render.schedule,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
  });
  const slashCommands = createSlashCommandActions({
    stateStore,
    currentClient,
    codexInput: (text) => composerController.codexInput(text),
    threads: {
      startNewThread: thread.startNewThread,
      startThreadForGoal: async (objective) => {
        const response = await refs.appServerThreads.startThread(objective, { syncGoal: false });
        return response?.threadId ?? null;
      },
      resumeThread: thread.selectThread,
      forkThread: (threadId) => refs.threadActions.forkThread(threadId),
      rollbackThread: (threadId) => refs.threadActions.rollbackThread(threadId),
      compactThread: (threadId) => refs.threadActions.compactThread(threadId),
      archiveThread: (threadId) => refs.threadActions.archiveThread(threadId),
      renameThread: (threadId, name) => refs.threadRename.rename(threadId, name),
      reconnect: () => refs.reconnectActions.reconnectPanel(),
    },
    runtime: {
      toggleFastMode: () => refs.runtimeSettings.toggleFastMode(),
      toggleCollaborationMode: () => refs.runtimeSettings.toggleCollaborationMode(),
      toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
      setRequestedModel: (model) => refs.runtimeSettings.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => refs.runtimeSettings.setRequestedReasoningEffort(effort),
    },
    goals: {
      activeGoal: () => refs.goals.activeGoal(),
      setObjective: (threadId, objective, tokenBudget) => refs.goals.setObjective(threadId, objective, tokenBudget),
      setStatus: (threadId, goalStatus) => refs.goals.setStatus(threadId, goalStatus),
      clear: (threadId) => refs.goals.clear(threadId),
    },
    status: {
      addSystemMessage: status.addSystemMessage,
      addStructuredSystemMessage: status.addStructuredSystemMessage,
      setStatus: status.set,
      statusSummaryLines: runtime.statusSummaryLines,
      connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
      mcpStatusLines: runtime.mcpStatusLines,
      modelStatusLines: runtime.modelStatusLines,
      effortStatusLines: runtime.effortStatusLines,
    },
  });
  const planImplementation = createPlanImplementationActions({
    stateStore,
    connection: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    submission: {
      sendTurnText: (text) => turnSubmission.sendTurnText(text),
    },
  });

  const messageRenderer = new ChatMessageRenderer({
    obsidian: {
      app,
      owner,
    },
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: plugin.vaultPath,
    },
    scroll: {
      consumeIntent: () => messageScrollIntent.consumeIntent(),
    },
    history: {
      loadOlderTurns: () => void refs.history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void refs.threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void refs.threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (item) => void planImplementation.implement(item),
      openTurnDiff: (state) => void plugin.openTurnDiff(state),
    },
    requests: {
      pendingSignature: render.pendingRequestsSignature,
      renderPending: () => pendingRequests.renderNode(),
    },
  });
  const composerSubmission = createComposerSubmissionActions({
    stateStore,
    composer: composerController,
    slashCommands,
    turnSubmission,
    connection: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
    scroll: {
      forceBottom: scroll.forceBottom,
    },
  });
  composerController.setActionHandlers({
    submit: () => void composerSubmission.submit(),
    threadScrollFromComposer: (action) => {
      messageRenderer.scrollFromComposer(action);
    },
  });

  return {
    pendingRequests,
    messageRenderer,
    composerController,
    composerSubmission,
  };
}
