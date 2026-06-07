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
      context.liveState.refresh();
      context.render.schedule();
    },
    onServerRequest: (request) => {
      controller.handleServerRequest(request);
      context.liveState.refresh();
      context.render.now();
    },
    onLog: (message) => {
      controller.handleAppServerLog(message);
      context.render.now();
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
  const { obsidian, plugin, state, client, lifecycle, render, runtime, thread, liveState, scroll, status, composer } = ports;
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
    liveState,
    scroll,
    status,
    composer,
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
  const {
    app,
    owner,
    plugin,
    state,
    stateStore,
    viewId,
    render,
    runtime,
    thread,
    liveState,
    scroll,
    status,
    lifecycle,
    currentClient,
    submissionState,
    client,
  } = context;
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
    state: createPendingRequestStatePort(stateStore),
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
    render: render.now,
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
    state: submissionState,
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
    state: submissionState,
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
  const { ports, obsidian, lifecycle, render, liveState, scroll, client } = context;
  const { deferredTasks } = lifecycle;

  return {
    appServerWarmup: new AppServerWarmupController({
      deferredTasks,
      opened: lifecycle.getOpened,
      closing: lifecycle.getClosing,
      connected: () => refs.connection.isConnected(),
      ensureConnected: client.ensureConnected,
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
      scrollMessagesToBottomOnFocus: scroll.bottomOnFocus,
      applyCachedSharedAppServerState: () => {
        applyCachedSharedAppServerState(ports, refs.appServerThreads, refs.appServerMetadata);
      },
      render: render.now,
      scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
      scheduleDeferredRestoredThreadHydration: lifecycle.scheduleDeferredRestoredThreadHydration,
      closeToolbarPanelOnOutsidePointer: render.closeToolbarPanelOnOutsidePointer,
      invalidateConnectionWork: lifecycle.invalidateConnectionWork,
      invalidateResumeWork: lifecycle.invalidateResumeWork,
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
      clearClient: client.clear,
      refreshLiveState: liveState.refresh,
      deferRefreshLiveState: liveState.deferRefresh,
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
  const { plugin, runtime, scroll, stateStore } = context;
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
    forceMessagesToBottom: scroll.forceBottom,
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
  const { plugin, thread, render, stateStore } = context;

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
      render.schedule();
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
  const { plugin, client, thread, status, liveState, render, lifecycle, connectionState } = context;
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
      invalidateResumeWork: lifecycle.invalidateResumeWork,
      loadSharedThreadList: thread.loadSharedThreadList,
      scheduleDeferredDiagnostics: lifecycle.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: lifecycle.clearDeferredDiagnostics,
      refreshTabHeader: thread.refreshTabHeader,
      resetThreadTurnPresence: thread.resetTurnPresence,
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
      configuredCommand: () => plugin.settings.codexPath,
      refreshLiveState: liveState.refresh,
      render: render.now,
      scheduleRender: render.schedule,
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
  const {
    obsidian,
    plugin,
    state,
    runtime,
    thread,
    status,
    liveState,
    scroll,
    render,
    client,
    composer,
    lifecycle,
    stateStore,
    currentClient,
    connectionState,
    panelState,
    threadState,
  } = context;
  const { deferredTasks, resumeWork } = lifecycle;

  const history = new ThreadHistoryController({
    stateStore,
    currentClient,
    render: render.now,
    addSystemMessage: status.addSystemMessage,
    forceMessagesToBottom: scroll.forceBottom,
    keepCurrentScrollPosition: scroll.preservePosition,
    setThreadTurnPresence: thread.resetTurnPresence,
  });
  const threadActions = new ChatThreadActionController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    archiveAdapter: obsidian.archiveAdapter,
    ensureConnected: client.ensureConnected,
    currentClient,
    history,
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: composer.setText,
    openThreadInNewView: (threadId) => plugin.openThreadInNewView(threadId),
    openThreadInCurrentPanel: thread.selectThread,
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: (threadId, name) => {
      plugin.notifyThreadRenamed(threadId, name);
    },
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshThreads: thread.refreshThreads,
    refreshSharedThreadListFromOpenSurface: () => {
      plugin.refreshSharedThreadListFromOpenSurface();
    },
  });
  const toolbarPanels = new ToolbarPanelController({
    stateStore,
    threadActions,
    scheduleRender: render.schedule,
  });
  const threadSelection = new ThreadSelectionController({
    panelState,
    threadState,
    closeForThreadSelection: () => {
      toolbarPanels.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => plugin.focusThreadInOpenView(threadId),
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
  const reconnectActions = new ChatReconnectController({
    connectionState,
    panelState,
    threadState,
    invalidateConnectionWork: lifecycle.invalidateConnectionWork,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredDiagnostics: lifecycle.clearDeferredDiagnostics,
    reconnect: () => {
      refs.connection.reconnect();
    },
    clearClient: client.clear,
    setStatus: status.set,
    render: render.now,
    ensureConnected: client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });
  const runtimeSettings = new ChatRuntimeSettingsController({
    stateStore,
    currentClient,
    runtimeSnapshot: runtime.runtimeSnapshot,
    collaborationModeLabel: runtime.collaborationModeLabel,
    addSystemMessage: status.addSystemMessage,
  });
  const goals = new ChatThreadGoalController({
    stateStore,
    currentClient,
    ensureConnected: client.ensureConnected,
    addSystemMessage: status.addSystemMessage,
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "transcript/item-upserted", item });
    },
    render: render.now,
    refreshLiveState: liveState.refresh,
  });
  const restoredThread = new RestoredThreadController({
    deferredTasks,
    opened: lifecycle.getOpened,
    resumeThread: thread.resumeThread,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    state: threadState,
    systemItem: state.systemItem,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const viewStateController = new ChatViewStateController({
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearRestoredThreadLifecycle: thread.clearRestoredLifecycle,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: lifecycle.scheduleDeferredAppServerWarmup,
    restoreThreadPlaceholder: thread.restorePlaceholder,
  });
  const threadResume = new ThreadResumeController({
    state: threadState,
    vaultPath: plugin.vaultPath,
    resumeWork,
    history,
    restoredThread,
    currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    systemItem: state.systemItem,
    resetThreadTurnPresence: thread.resetTurnPresence,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    forceMessagesToBottom: scroll.forceBottom,
    render: render.now,
    refreshLiveState: liveState.refresh,
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
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredRestoredThreadHydration: lifecycle.clearDeferredRestoredThreadHydration,
    resetThreadTurnPresence: thread.resetTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
    refreshLiveState: liveState.refresh,
    render: render.now,
  });
  const threadRename = new ThreadRenameController({
    stateStore,
    vaultPath: plugin.vaultPath,
    settings: () => plugin.settings,
    ensureConnected: client.ensureConnected,
    currentClient: () => refs.connection.currentClient(),
    refreshThreads: thread.refreshThreads,
    render: render.shellSlots,
    addSystemMessage: status.addSystemMessage,
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
