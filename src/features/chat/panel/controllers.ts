import { Notice } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection-manager";
import { recoverRolloutTokenUsage } from "../../../app-server/rollout-token-usage";
import { currentModel } from "../../../runtime/state";
import { ChatAppServerDiagnosticsController } from "../app-server/diagnostics-controller";
import { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import { ChatAppServerThreadController } from "../app-server/thread-controller";
import { ChatComposerController } from "../composer/controller";
import { ChatInboundController } from "../inbound/controller";
import type { ChatState } from "../chat-state";
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
import type { ChatViewControllerPorts } from "./controller-ports";

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
type ControllerRef<T> = () => T;

export function createChatViewControllers(ports: ChatViewControllerPorts): ChatViewControllers {
  const context = createControllerContext(ports);
  let connection!: ConnectionManager;
  let controller!: ChatInboundController;
  let appServerThreads!: ChatAppServerThreadController;
  let appServerMetadata!: ChatAppServerMetadataController;
  let appServerDiagnostics!: ChatAppServerDiagnosticsController;
  let connectionController!: ChatConnectionController;
  let history!: ThreadHistoryController;
  let threadResume!: ThreadResumeController;
  let threadActions!: ChatThreadActionController;
  let runtimeSettings!: ChatRuntimeSettingsController;
  let goals!: ChatThreadGoalController;
  let restoredThread!: RestoredThreadController;
  let threadIdentity!: ThreadIdentityController;
  let threadRename!: ThreadRenameController;
  let pendingRequests!: PendingRequestController;
  let toolbarPanels!: ToolbarPanelController;
  let reconnectActions!: ChatReconnectController;
  let composerController!: ChatComposerController;
  let messageRenderer!: ChatMessageRenderer;
  let renderController!: ChatViewRenderController;
  let openCloseController!: ChatViewOpenCloseController;
  let viewStateController!: ChatViewStateController;
  let appServerWarmup!: AppServerWarmupController;
  let composerSubmission!: ComposerSubmissionController;
  let threadSelection!: ThreadSelectionController;
  let serverRequestResponder!: ServerRequestResponder;

  ({ renderController } = createViewRenderControllerGroup(context, {
    connection: () => connection,
  }));

  ({ messageRenderer, composerController, composerSubmission, serverRequestResponder } = createSubmissionControllerGroup(context, {
    appServerThreads: () => appServerThreads,
    runtimeSettings: () => runtimeSettings,
    threadActions: () => threadActions,
    threadRename: () => threadRename,
    reconnectActions: () => reconnectActions,
    goals: () => goals,
    history: () => history,
    pendingRequests: () => pendingRequests,
  }));

  ({ connection, appServerWarmup, openCloseController } = createConnectionLifecycleControllerGroup(context, {
    controller: () => controller,
    connectionController: () => connectionController,
    composerController: () => composerController,
    messageRenderer: () => messageRenderer,
    appServerThreads: () => appServerThreads,
    appServerMetadata: () => appServerMetadata,
  }));

  ({ appServerThreads, appServerMetadata, appServerDiagnostics } = createAppServerControllerGroup(context, {
    connection,
    goals: () => goals,
  }));

  controller = createInboundController(context, {
    appServerMetadata,
    appServerDiagnostics,
    threadRename: () => threadRename,
    serverRequestResponder,
  });

  connectionController = createConnectionControllerGroup(context, {
    connection,
    appServerMetadata,
    appServerDiagnostics,
  }).connectionController;

  ({
    pendingRequests,
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
  } = createRequestThreadToolbarControllerGroup(context, {
    connection,
    controller,
    composerController,
  }));

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

function createControllerContext(ports: ChatViewControllerPorts) {
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
    connection: ControllerRef<ConnectionManager>;
  },
) {
  const { plugin, render, lifecycle, stateStore } = context;
  const { deferredTasks } = lifecycle;

  return {
    renderController: new ChatViewRenderController({
      shell: createChatShellRenderPort(stateStore, {
        connected: () => refs.connection().isConnected(),
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
    appServerThreads: ControllerRef<ChatAppServerThreadController>;
    runtimeSettings: ControllerRef<ChatRuntimeSettingsController>;
    threadActions: ControllerRef<ChatThreadActionController>;
    threadRename: ControllerRef<ThreadRenameController>;
    reconnectActions: ControllerRef<ChatReconnectController>;
    goals: ControllerRef<ChatThreadGoalController>;
    history: ControllerRef<ThreadHistoryController>;
    pendingRequests: ControllerRef<PendingRequestController>;
  },
) {
  const { app, owner, plugin, state, stateStore, viewId, render, runtime, thread, effects, lifecycle, currentClient, submissionState } =
    context;
  const { messageScroll } = lifecycle;
  let composerController!: ChatComposerController;
  let messageRenderer!: ChatMessageRenderer;
  let composerSubmission!: ComposerSubmissionController;

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
      startThread: (preview) => refs.appServerThreads().startThread(preview),
      notifyActiveThreadIdentityChanged: effects.thread.notifyIdentityChanged,
      resetThreadTurnPresence: effects.thread.resetTurnPresence,
    },
    runtime: {
      applyPendingThreadSettings: () => refs.runtimeSettings().applyPendingThreadSettings(),
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
        const response = await refs.appServerThreads().startThread(objective, { syncGoal: false });
        return response?.thread.id ?? null;
      },
      resumeThread: thread.selectThread,
      forkThread: (threadId) => refs.threadActions().forkThread(threadId),
      rollbackThread: (threadId) => refs.threadActions().rollbackThread(threadId),
      compactThread: (threadId) => refs.threadActions().compactThread(threadId),
      archiveThread: (threadId) => refs.threadActions().archiveThread(threadId),
      renameThread: (threadId, name) => refs.threadRename().rename(threadId, name),
      reconnect: () => refs.reconnectActions().reconnectPanel(),
    },
    runtime: {
      toggleFastMode: () => refs.runtimeSettings().toggleFastMode(),
      toggleCollaborationMode: () => refs.runtimeSettings().toggleCollaborationMode(),
      toggleAutoReview: () => void refs.runtimeSettings().toggleAutoReview(),
      setRequestedModel: (model) => refs.runtimeSettings().setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => refs.runtimeSettings().setRequestedReasoningEffort(effort),
    },
    goals: {
      activeGoal: () => refs.goals().activeGoal(),
      setObjective: (threadId, objective, tokenBudget) => refs.goals().setObjective(threadId, objective, tokenBudget),
      setStatus: (threadId, status) => refs.goals().setStatus(threadId, status),
      clear: (threadId) => refs.goals().clear(threadId),
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
  const serverRequestResponder = new ServerRequestResponder({
    currentClient,
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

  messageRenderer = new ChatMessageRenderer({
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
      consumeIntent: () => messageScroll.consumeIntent(),
    },
    history: {
      loadOlderTurns: () => void refs.history().loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void refs.threadActions().rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) =>
        void refs.threadActions().forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (item) => void planImplementation.implement(item),
      openTurnDiff: (state) => void plugin.openTurnDiff(state),
    },
    requests: {
      pendingSignature: render.pendingRequestsSignature,
      renderPending: () => refs.pendingRequests().renderNode(),
    },
  });
  composerController = new ChatComposerController({
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
    togglePlan: () => void refs.runtimeSettings().toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings().toggleAutoReview(),
    toggleFast: () => void refs.runtimeSettings().toggleFastMode(),
    renderIfDetached: effects.render.now,
    onDraftChange: effects.liveState.refresh,
    onComposerResize: () => {
      effects.scroll.correctAfterLayoutChange();
    },
    onSubmit: () => void composerSubmission.submit(),
    onThreadScrollFromComposer: (action) => {
      messageRenderer.scrollFromComposer(action);
    },
  });
  composerSubmission = new ComposerSubmissionController({
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

  return {
    messageRenderer,
    composerController,
    composerSubmission,
    serverRequestResponder,
  };
}

function createConnectionLifecycleControllerGroup(
  context: ControllerContext,
  refs: {
    controller: ControllerRef<ChatInboundController>;
    connectionController: ControllerRef<ChatConnectionController>;
    composerController: ControllerRef<ChatComposerController>;
    messageRenderer: ControllerRef<ChatMessageRenderer>;
    appServerThreads: ControllerRef<ChatAppServerThreadController>;
    appServerMetadata: ControllerRef<ChatAppServerMetadataController>;
  },
) {
  const { ports, obsidian, plugin, lifecycle, render, effects } = context;
  const { deferredTasks } = lifecycle;
  const connection = new ConnectionManager(() => plugin.settings.codexPath, plugin.vaultPath, {
    onNotification: (notification) => {
      refs.controller().handleNotification(notification);
      effects.liveState.refresh();
      effects.render.schedule();
    },
    onServerRequest: (request) => {
      refs.controller().handleServerRequest(request);
      effects.liveState.refresh();
      effects.render.now();
    },
    onLog: (message) => {
      refs.controller().handleAppServerLog(message);
      effects.render.now();
    },
    onExit: () => {
      refs.connectionController().handleExit();
    },
  });

  return {
    connection,
    appServerWarmup: new AppServerWarmupController({
      deferredTasks,
      opened: lifecycle.getOpened,
      closing: lifecycle.getClosing,
      connected: () => connection.isConnected(),
      ensureConnected: effects.client.ensureConnected,
    }),
    openCloseController: new ChatViewOpenCloseController({
      setOpened: lifecycle.setOpened,
      setClosing: lifecycle.setClosing,
      registerEvent: obsidian.registerEvent,
      registerComposerNoteIndexInvalidation: (register) => {
        refs.composerController().registerNoteIndexInvalidation(register);
      },
      registerPointerDown: obsidian.registerPointerDown,
      registerActiveLeafChange: obsidian.registerActiveLeafChange,
      isOwnLeaf: obsidian.isOwnLeaf,
      scrollMessagesToBottomOnFocus: effects.scroll.bottomOnFocus,
      applyCachedSharedAppServerState: () => {
        applyCachedSharedAppServerState(ports, refs.appServerThreads(), refs.appServerMetadata());
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
        refs.messageRenderer().dispose();
      },
      disposeComposer: () => {
        refs.composerController().dispose();
      },
      disconnect: () => {
        connection.disconnect();
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
    goals: ControllerRef<ChatThreadGoalController>;
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
      void refs.goals().syncThreadGoal(threadId);
    },
  });

  return { appServerThreads, appServerMetadata, appServerDiagnostics };
}

function createInboundController(
  context: ControllerContext,
  refs: {
    appServerMetadata: ChatAppServerMetadataController;
    appServerDiagnostics: ChatAppServerDiagnosticsController;
    threadRename: ControllerRef<ThreadRenameController>;
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
      refs.threadRename().maybeAutoNameThread(threadId, turn);
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

function createRequestThreadToolbarControllerGroup(
  context: ControllerContext,
  refs: {
    connection: ConnectionManager;
    controller: ChatInboundController;
    composerController: ChatComposerController;
  },
) {
  const { obsidian, plugin, runtime, thread, effects, lifecycle, stateStore, currentClient, connectionState, panelState, threadState } =
    context;
  const { deferredTasks, resumeWork } = lifecycle;

  const pendingRequests = new PendingRequestController({
    state: createPendingRequestStatePort(stateStore),
    controller: refs.controller,
    composerHasFocus: () => refs.composerController.hasFocus(),
    refreshLiveState: effects.liveState.refresh,
    render: effects.render.now,
  });
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
    pendingRequests,
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

function activeTurnId(state: ChatState): string | null {
  return state.turn.lifecycle.kind === "running" ? state.turn.lifecycle.turnId : null;
}

function applyCachedSharedAppServerState(
  ports: ChatViewControllerPorts,
  appServerThreads: ChatAppServerThreadController,
  appServerMetadata: ChatAppServerMetadataController,
): void {
  const threads = ports.plugin.cachedThreadList();
  if (threads) appServerThreads.applyThreadList(threads);
  const metadata = ports.plugin.cachedAppServerMetadata();
  if (metadata) appServerMetadata.applyAppServerMetadata(metadata);
}
