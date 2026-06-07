import { Notice } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection-manager";
import { recoverRolloutTokenUsage } from "../../../app-server/rollout-token-usage";
import { currentModel } from "../../../runtime/state";
import { ChatAppServerDiagnosticsController } from "../app-server/diagnostics-controller";
import { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import { ChatAppServerThreadController } from "../app-server/thread-controller";
import { ChatComposerController } from "../composer/controller";
import { ChatInboundController } from "../inbound/controller";
import { activeTurnId } from "../chat-state";
import { ChatThreadGoalController } from "../controllers/thread/thread-goal-controller";
import { ChatRuntimeSettingsController } from "../controllers/runtime/runtime-settings-controller";
import { ChatThreadActionController } from "../controllers/thread/thread-actions-controller";
import { ThreadHistoryController } from "../controllers/thread/thread-history-controller";
import { ThreadRenameController } from "../controllers/thread/thread-rename-controller";
import { ToolbarPanelController } from "./toolbar-controller";
import { AppServerWarmupController } from "../controllers/connection/app-server-warmup-controller";
import { ChatConnectionController } from "../controllers/connection/connection-controller";
import { ChatReconnectController } from "../controllers/connection/reconnect-controller";
import { PendingRequestController } from "../controllers/requests/pending-request-controller";
import { ServerRequestResponder } from "../controllers/requests/server-request-responder";
import {
  createChatShellRenderPort,
  createConnectionStatePort,
  createPanelUiStatePort,
  createPendingRequestStatePort,
  createSubmissionStatePort,
  createThreadLifecycleStatePort,
} from "../controllers/state-ports";
import { ComposerSubmissionController } from "../controllers/submission/composer-submission-controller";
import { PlanImplementationController } from "../controllers/submission/plan-implementation-controller";
import { SlashCommandController } from "../controllers/submission/slash-command-controller";
import { TurnSubmissionController } from "../controllers/submission/turn-submission-controller";
import { RestoredThreadController } from "../controllers/thread/restored-thread-controller";
import { ThreadIdentityController } from "../controllers/thread/thread-identity-controller";
import { ThreadResumeController } from "../controllers/thread/thread-resume-controller";
import { ThreadSelectionController } from "../controllers/thread/thread-selection-controller";
import { ChatViewOpenCloseController } from "../controllers/view/view-open-close-controller";
import { ChatViewRenderController } from "../controllers/view/view-render-controller";
import { ChatViewStateController } from "../controllers/view/view-state-controller";
import { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatPanelContext } from "./context";

export interface ChatViewControllers {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
    reconnect: ChatReconnectController;
    warmup: AppServerWarmupController;
  };
  inbound: {
    controller: ChatInboundController;
  };
  appServer: {
    threads: ChatAppServerThreadController;
    metadata: ChatAppServerMetadataController;
    diagnostics: ChatAppServerDiagnosticsController;
  };
  thread: {
    history: ThreadHistoryController;
    resume: ThreadResumeController;
    actions: ChatThreadActionController;
    restored: RestoredThreadController;
    identity: ThreadIdentityController;
    rename: ThreadRenameController;
    selection: ThreadSelectionController;
  };
  runtime: {
    settings: ChatRuntimeSettingsController;
    goals: ChatThreadGoalController;
  };
  requests: {
    pending: PendingRequestController;
  };
  toolbar: {
    panels: ToolbarPanelController;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmissionController;
  };
  render: {
    controller: ChatViewRenderController;
    messages: ChatMessageRenderer;
    openClose: ChatViewOpenCloseController;
    viewState: ChatViewStateController;
  };
}

type ControllerContext = ReturnType<typeof createControllerContext>;

export function createChatViewControllers(ports: ChatPanelContext): ChatViewControllers {
  const context = createControllerContext(ports);
  const connection = new ConnectionManager(() => context.plugin.settings.codexPath, context.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup(context, { connection });
  const {
    history,
    threadActions,
    toolbarPanels,
    threadSelection,
    reconnectActions,
    runtimeSettings,
    goals,
    restoredThread,
    viewStateController,
    threadResume,
    threadIdentity,
    threadRename,
  } = createThreadToolbarControllerGroup(context, {
    connection,
  });
  const { appServerThreads, appServerMetadata, appServerDiagnostics } = createAppServerControllerGroup(context, {
    connection,
    goals,
  });
  const serverRequestResponder = new ServerRequestResponder({
    currentClient: context.currentClient,
  });
  const controller = createInboundController(context, {
    appServerMetadata,
    appServerDiagnostics,
    threadRename,
    serverRequestResponder,
  });
  const { connectionController } = createConnectionControllerGroup(context, {
    connection,
    appServerMetadata,
    appServerDiagnostics,
  });

  connection.setHandlers({
    onNotification: (notification) => {
      controller.handleNotification(notification);
      context.effects.liveState.refresh();
      context.effects.render.schedule();
    },
    onServerRequest: (request) => {
      controller.handleServerRequest(request);
      context.effects.liveState.refresh();
      context.effects.render.now();
    },
    onLog: (message) => {
      controller.handleAppServerLog(message);
      context.effects.render.now();
    },
    onExit: () => {
      connectionController.handleExit();
    },
  });

  const { pendingRequests, messageRenderer, composerController, composerSubmission } = createSubmissionControllerGroup(context, {
    controller,
    appServerThreads,
    runtimeSettings,
    threadActions,
    threadRename,
    reconnectActions,
    goals,
    history,
  });
  const { appServerWarmup, openCloseController } = createConnectionLifecycleControllerGroup(context, {
    connection,
    composerController,
    messageRenderer,
    appServerThreads,
    appServerMetadata,
  });

  return {
    connection: {
      manager: connection,
      controller: connectionController,
      reconnect: reconnectActions,
      warmup: appServerWarmup,
    },
    inbound: {
      controller,
    },
    appServer: {
      threads: appServerThreads,
      metadata: appServerMetadata,
      diagnostics: appServerDiagnostics,
    },
    thread: {
      history,
      resume: threadResume,
      actions: threadActions,
      restored: restoredThread,
      identity: threadIdentity,
      rename: threadRename,
      selection: threadSelection,
    },
    runtime: {
      settings: runtimeSettings,
      goals,
    },
    requests: {
      pending: pendingRequests,
    },
    toolbar: {
      panels: toolbarPanels,
    },
    composer: {
      controller: composerController,
      submission: composerSubmission,
    },
    render: {
      controller: renderController,
      messages: messageRenderer,
      openClose: openCloseController,
      viewState: viewStateController,
    },
  };
}

function createControllerContext(ports: ChatPanelContext) {
  const { obsidian, plugin, state, client, lifecycle, render, runtime, thread, effects } = ports;
  const { app, owner, viewId } = obsidian;
  const { stateStore } = state;

  return {
    ports,
    obsidian,
    plugin,
    state,
    client,
    lifecycle,
    render,
    runtime,
    thread,
    effects,
    app,
    owner,
    viewId,
    stateStore,
    currentClient: client.getClient,
    connectionState: createConnectionStatePort(stateStore),
    panelState: createPanelUiStatePort(stateStore),
    submissionState: createSubmissionStatePort(stateStore),
    threadState: createThreadLifecycleStatePort(stateStore),
  };
}

function createViewRenderControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { plugin, render, lifecycle, stateStore } = context;
  const { deferredTasks } = lifecycle;

  return {
    renderController: new ChatViewRenderController({
      shell: createChatShellRenderPort(stateStore, {
        connected: () => refs.connection.isConnected(),
        showToolbar: () => plugin.settings.showToolbar,
        pendingRequestsSignature: render.pendingRequestsSignature,
        activeComposerThreadName: render.activeComposerThreadName,
      }),
      panelRoot: render.panelRoot,
      renderToolbar: render.renderToolbar,
      renderGoal: render.renderGoal,
      renderMessages: render.renderMessages,
      renderComposer: render.renderComposer,
      clearScheduledRender: () => {
        deferredTasks.clearRender();
      },
    }),
  };
}

function createSubmissionControllerGroup(
  context: ControllerContext,
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
  const { app, owner, plugin, state, stateStore, viewId, render, runtime, thread, effects, lifecycle, currentClient, submissionState } =
    context;
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
    renderIfDetached: effects.render.now,
    onDraftChange: effects.liveState.refresh,
    onComposerResize: () => {
      effects.scroll.correctAfterLayoutChange();
    },
  });
  const pendingRequests = new PendingRequestController({
    state: createPendingRequestStatePort(stateStore),
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: effects.liveState.refresh,
    render: effects.render.now,
  });

  const turnSubmission = new TurnSubmissionController({
    state: submissionState,
    connection: {
      vaultPath: plugin.vaultPath,
      currentClient,
    },
    restoredThread: {
      ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    },
    thread: {
      startThread: (preview) => refs.appServerThreads.startThread(preview),
      notifyActiveThreadIdentityChanged: effects.thread.notifyIdentityChanged,
      resetThreadTurnPresence: effects.thread.resetTurnPresence,
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
      forceMessagesToBottom: effects.scroll.forceBottom,
      render: effects.render.now,
      scheduleRender: effects.render.schedule,
    },
    status: {
      setStatus: effects.status.set,
      addSystemMessage: effects.status.addSystemMessage,
    },
  });
  const slashCommands = new SlashCommandController({
    state: submissionState,
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
      setStatus: (threadId, status) => refs.goals.setStatus(threadId, status),
      clear: (threadId) => refs.goals.clear(threadId),
    },
    status: {
      addSystemMessage: effects.status.addSystemMessage,
      addStructuredSystemMessage: effects.status.addStructuredSystemMessage,
      setStatus: effects.status.set,
      statusSummaryLines: runtime.statusSummaryLines,
      connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
      mcpStatusLines: runtime.mcpStatusLines,
      modelStatusLines: runtime.modelStatusLines,
      effortStatusLines: runtime.effortStatusLines,
    },
  });
  const planImplementation = new PlanImplementationController({
    state: submissionState,
    connection: {
      currentClient,
      ensureConnected: effects.client.ensureConnected,
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
    state: submissionState,
    composer: composerController,
    slashCommands,
    turnSubmission,
    connection: {
      currentClient,
      ensureConnected: effects.client.ensureConnected,
    },
    status: {
      setStatus: effects.status.set,
      addSystemMessage: effects.status.addSystemMessage,
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

function createConnectionLifecycleControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
    composerController: ChatComposerController;
    messageRenderer: ChatMessageRenderer;
    appServerThreads: ChatAppServerThreadController;
    appServerMetadata: ChatAppServerMetadataController;
  },
) {
  const { ports, obsidian, lifecycle, render, effects } = context;
  const { deferredTasks } = lifecycle;

  return {
    appServerWarmup: new AppServerWarmupController({
      deferredTasks,
      opened: lifecycle.getOpened,
      closing: lifecycle.getClosing,
      connected: () => refs.connection.isConnected(),
      ensureConnected: effects.client.ensureConnected,
    }),
    openCloseController: new ChatViewOpenCloseController({
      setOpened: lifecycle.setOpened,
      setClosing: lifecycle.setClosing,
      registerEvent: obsidian.registerEvent,
      registerComposerNoteIndexInvalidation: (register) => {
        refs.composerController.registerNoteIndexInvalidation(register);
      },
      registerPointerDown: obsidian.registerPointerDown,
      registerActiveLeafChange: obsidian.registerActiveLeafChange,
      isOwnLeaf: obsidian.isOwnLeaf,
      scrollMessagesToBottomOnFocus: effects.scroll.bottomOnFocus,
      applyCachedSharedAppServerState: () => {
        applyCachedSharedAppServerState(ports, refs.appServerThreads, refs.appServerMetadata);
      },
      render: effects.render.now,
      scheduleDeferredAppServerWarmup: effects.lifecycle.scheduleDeferredAppServerWarmup,
      scheduleDeferredRestoredThreadHydration: effects.lifecycle.scheduleDeferredRestoredThreadHydration,
      closeToolbarPanelOnOutsidePointer: render.closeToolbarPanelOnOutsidePointer,
      invalidateConnectionWork: effects.lifecycle.invalidateConnectionWork,
      invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
      clearDeferredTasks: () => {
        deferredTasks.clearAll();
      },
      panelRoot: render.panelRoot,
      disposeMessages: () => {
        refs.messageRenderer.dispose();
      },
      disposeComposer: () => {
        refs.composerController.dispose();
      },
      disconnect: () => {
        refs.connection.disconnect();
      },
      clearClient: effects.client.clear,
      refreshLiveState: effects.liveState.refresh,
      deferRefreshLiveState: effects.liveState.deferRefresh,
    }),
  };
}

function createAppServerControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
    goals: ChatThreadGoalController;
  },
) {
  const { plugin, runtime, effects, stateStore } = context;
  const appServerBaseHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient: () => refs.connection.currentClient(),
  };
  const appServerMetadata = new ChatAppServerMetadataController({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const appServerDiagnostics = new ChatAppServerDiagnosticsController({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    appServerMetadataSnapshot: () => appServerMetadata.appServerMetadataSnapshot(),
  });
  const appServerThreads = new ChatAppServerThreadController({
    ...appServerBaseHost,
    runtimeSnapshot: runtime.runtimeSnapshot,
    forceMessagesToBottom: effects.scroll.forceBottom,
    publishThreadList: (threads) => {
      plugin.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void refs.goals.syncThreadGoal(threadId);
    },
  });

  return { appServerThreads, appServerMetadata, appServerDiagnostics };
}

function createInboundController(
  context: ControllerContext,
  refs: {
    appServerMetadata: ChatAppServerMetadataController;
    appServerDiagnostics: ChatAppServerDiagnosticsController;
    threadRename: ThreadRenameController;
    serverRequestResponder: ServerRequestResponder;
  },
) {
  const { plugin, thread, effects, stateStore } = context;

  return new ChatInboundController(stateStore, {
    refreshThreads: () => {
      void thread.refreshThreads();
    },
    refreshRateLimits: () => {
      void refs.appServerMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void thread.refreshSkills(forceReload),
    publishAppServerMetadata: thread.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turn) => {
      refs.threadRename.maybeAutoNameThread(threadId, turn);
    },
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
    recordMcpStartupStatus: (name, status, message) => {
      refs.appServerDiagnostics.recordMcpStartupStatus(name, status, message);
      effects.render.schedule();
    },
    respondToServerRequest: (requestId, result) => refs.serverRequestResponder.respond(requestId, result),
    rejectServerRequest: (requestId, code, message) => refs.serverRequestResponder.reject(requestId, code, message),
  });
}

function createConnectionControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
    appServerMetadata: ChatAppServerMetadataController;
    appServerDiagnostics: ChatAppServerDiagnosticsController;
  },
) {
  const { plugin, client, thread, effects, lifecycle, connectionState } = context;
  const { connectionWork } = lifecycle;

  return {
    connectionController: new ChatConnectionController({
      state: connectionState,
      connection: refs.connection,
      connectionWork,
      metadata: {
        refreshPublishedAppServerMetadata: () => refs.appServerMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => refs.appServerMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedCapabilityDiagnostics: () => refs.appServerDiagnostics.refreshPublishedCapabilityDiagnostics(),
      },
      setClient: client.setClient,
      invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
      loadSharedThreadList: thread.loadSharedThreadList,
      scheduleDeferredDiagnostics: effects.lifecycle.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: effects.lifecycle.clearDeferredDiagnostics,
      refreshTabHeader: effects.thread.refreshTabHeader,
      resetThreadTurnPresence: effects.thread.resetTurnPresence,
      setStatus: effects.status.set,
      addSystemMessage: effects.status.addSystemMessage,
      configuredCommand: () => plugin.settings.codexPath,
      refreshLiveState: effects.liveState.refresh,
      render: effects.render.now,
      scheduleRender: effects.render.schedule,
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    }),
  };
}

function createThreadToolbarControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { obsidian, plugin, runtime, thread, effects, lifecycle, stateStore, currentClient, connectionState, panelState, threadState } =
    context;
  const { deferredTasks, resumeWork } = lifecycle;

  const history = new ThreadHistoryController({
    stateStore,
    currentClient,
    render: effects.render.now,
    addSystemMessage: effects.status.addSystemMessage,
    forceMessagesToBottom: effects.scroll.forceBottom,
    keepCurrentScrollPosition: effects.scroll.preservePosition,
    setThreadTurnPresence: effects.thread.resetTurnPresence,
  });
  const threadActions = new ChatThreadActionController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: effects.client.ensureConnected,
    currentClient,
    history,
    addSystemMessage: effects.status.addSystemMessage,
    setStatus: effects.status.set,
    setComposerText: effects.composer.setText,
    openThreadInNewView: (threadId) => plugin.openThreadInNewView(threadId),
    openThreadInCurrentPanel: thread.selectThread,
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: (threadId, name) => {
      plugin.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: effects.thread.notifyIdentityChanged,
    refreshThreads: thread.refreshThreads,
    refreshSharedThreadListFromOpenSurface: () => {
      plugin.refreshSharedThreadListFromOpenSurface();
    },
  });
  const toolbarPanels = new ToolbarPanelController({
    stateStore,
    threadActions,
    scheduleRender: effects.render.schedule,
  });
  const threadSelection = new ThreadSelectionController({
    panelState,
    threadState,
    closeForThreadSelection: () => {
      toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: effects.status.addSystemMessage,
  });
  const reconnectActions = new ChatReconnectController({
    connectionState,
    panelState,
    threadState,
    invalidateConnectionWork: effects.lifecycle.invalidateConnectionWork,
    invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
    clearDeferredDiagnostics: effects.lifecycle.clearDeferredDiagnostics,
    reconnect: () => {
      refs.connection.reconnect();
    },
    clearClient: effects.client.clear,
    setStatus: effects.status.set,
    render: effects.render.now,
    ensureConnected: effects.client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: effects.status.addSystemMessage,
  });
  const runtimeSettings = new ChatRuntimeSettingsController({
    stateStore,
    currentClient,
    runtimeSnapshot: runtime.runtimeSnapshot,
    collaborationModeLabel: runtime.collaborationModeLabel,
    addSystemMessage: effects.status.addSystemMessage,
  });
  const goals = new ChatThreadGoalController({
    stateStore,
    currentClient,
    ensureConnected: effects.client.ensureConnected,
    addSystemMessage: effects.status.addSystemMessage,
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "transcript/item-upserted", item });
    },
    render: effects.render.now,
    refreshLiveState: effects.liveState.refresh,
  });
  const restoredThread = new RestoredThreadController({
    deferredTasks,
    opened: lifecycle.getOpened,
    resumeThread: thread.resumeThread,
    invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
    state: threadState,
    systemItem: effects.state.systemItem,
    setStatus: effects.status.set,
    refreshTabHeader: effects.thread.refreshTabHeader,
  });
  const viewStateController = new ChatViewStateController({
    invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: effects.thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: effects.lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: effects.lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: effects.thread.restorePlaceholder,
  });
  const threadResume = new ThreadResumeController({
    state: threadState,
    vaultPath: plugin.vaultPath,
    resumeWork,
    history,
    restoredThread,
    currentClient,
    ensureConnected: effects.client.ensureConnected,
    closing: lifecycle.getClosing,
    systemItem: effects.state.systemItem,
    resetThreadTurnPresence: effects.thread.resetTurnPresence,
    clearDeferredRestoredThreadHydration: effects.lifecycle.clearDeferredRestoredThreadHydration,
    notifyActiveThreadIdentityChanged: effects.thread.notifyIdentityChanged,
    addSystemMessage: effects.status.addSystemMessage,
    forceMessagesToBottom: effects.scroll.forceBottom,
    render: effects.render.now,
    refreshLiveState: effects.liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, async (filePath, options) => {
        const response = await currentClient()?.readFile(filePath, options);
        return response?.dataBase64 ?? "";
      }),
  });
  const threadIdentity = new ThreadIdentityController({
    state: threadState,
    restoredThread,
    invalidateResumeWork: effects.lifecycle.invalidateResumeWork,
    clearDeferredRestoredThreadHydration: effects.lifecycle.clearDeferredRestoredThreadHydration,
    resetThreadTurnPresence: effects.thread.resetTurnPresence,
    notifyActiveThreadIdentityChanged: effects.thread.notifyIdentityChanged,
    refreshTabHeader: effects.thread.refreshTabHeader,
    refreshLiveState: effects.liveState.refresh,
    render: effects.render.now,
  });
  const threadRename = new ThreadRenameController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: effects.client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    refreshThreads: thread.refreshThreads,
    render: effects.render.shellSlots,
    addSystemMessage: effects.status.addSystemMessage,
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
  });

  return {
    history,
    threadActions,
    toolbarPanels,
    threadSelection,
    reconnectActions,
    runtimeSettings,
    goals,
    restoredThread,
    viewStateController,
    threadResume,
    threadIdentity,
    threadRename,
  };
}

function applyCachedSharedAppServerState(
  ports: ChatPanelContext,
  appServerThreads: ChatAppServerThreadController,
  appServerMetadata: ChatAppServerMetadataController,
): void {
  const threads = ports.plugin.cachedThreadList();
  if (threads) appServerThreads.applyThreadList(threads);
  const metadata = ports.plugin.cachedAppServerMetadata();
  if (metadata) appServerMetadata.applyAppServerMetadata(metadata);
}
