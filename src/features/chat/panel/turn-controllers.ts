import type { ChatAppServerThreadController } from "../app-server/thread-controller";
import { ChatComposerController } from "../composer/controller";
import { activeTurnId } from "../chat-state";
import type { ChatReconnectController } from "../controllers/connection/reconnect-controller";
import { PendingRequestController } from "../controllers/requests/pending-request-controller";
import type { ChatRuntimeSettingsController } from "../controllers/runtime/runtime-settings-controller";
import { ComposerSubmissionController } from "../controllers/submission/composer-submission-controller";
import { PlanImplementationController } from "../controllers/submission/plan-implementation-controller";
import { SlashCommandController } from "../controllers/submission/slash-command-controller";
import { TurnSubmissionController } from "../controllers/submission/turn-submission-controller";
import type { ChatThreadActionController } from "../controllers/thread/thread-actions-controller";
import type { ChatThreadGoalController } from "../controllers/thread/thread-goal-controller";
import type { ThreadHistoryController } from "../controllers/thread/thread-history-controller";
import type { ThreadRenameController } from "../controllers/thread/thread-rename-controller";
import type { ChatInboundController } from "../inbound/controller";
import { currentModel } from "../../../runtime/state";
import { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatPanelContext } from "./context";

export function createTurnControllerGroup(
  context: ChatPanelContext,
  refs: {
    controller: ChatInboundController;
    appServerThreads: ChatAppServerThreadController;
    runtimeSettings: ChatRuntimeSettingsController;
    threadActions: ChatThreadActionController;
    threadRename: ThreadRenameController;
    reconnectActions: ChatReconnectController;
    goals: ChatThreadGoalController;
    history: ThreadHistoryController;
  },
) {
  const { plugin, state, render, runtime, thread, liveState, scroll, status, lifecycle, client } = context;
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
    onComposerResize: () => {
      scroll.correctAfterLayoutChange();
    },
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
      forceMessagesToBottom: scroll.forceBottom,
      render: render.now,
      scheduleRender: render.schedule,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
  });
  const slashCommands = new SlashCommandController({
    stateStore,
    currentClient,
    codexInput: (text) => composerController.codexInput(text),
    threads: {
      startNewThread: thread.startNewThread,
      startThreadForGoal: async (objective) => {
        const response = await refs.appServerThreads.startThread(objective, { syncGoal: false });
        return response?.thread.id ?? null;
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
  const planImplementation = new PlanImplementationController({
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
  const composerSubmission = new ComposerSubmissionController({
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
