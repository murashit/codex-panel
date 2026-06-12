import { ConnectionManager } from "../../app-server/connection-manager";
import type { ChatServerDiagnosticsActions } from "./connection/server-actions/diagnostics";
import type { ChatServerMetadataActions } from "./connection/server-actions/metadata";
import type { ChatServerThreadActions } from "./connection/server-actions/threads";
import type { ChatComposerController } from "./conversation/composer/controller";
import type { ChatInboundController } from "./protocol/inbound/controller";
import type { GoalActions } from "./threads/goal-actions";
import { createChatRuntimeSettingsActions, type ChatRuntimeSettingsActions } from "./runtime/settings-actions";
import type { ChatThreadActions } from "./threads/actions";
import type { AutoTitleController } from "./threads/auto-title-controller";
import type { HistoryController } from "./threads/history-controller";
import type { RenameController } from "./threads/rename-controller";
import type { ToolbarPanelController } from "./panel/regions/toolbar";
import type { ChatConnectionController } from "./connection/connection-controller";
import type { ChatReconnectActions } from "./connection/reconnect-actions";
import type { PendingRequestController } from "./conversation/pending-requests/controller";
import { rejectServerRequest, respondToServerRequest } from "./protocol/server-requests/responder";
import type { ComposerSubmitActions } from "./conversation/turns/composer-submit-actions";
import type { RestorationController } from "./threads/restoration-controller";
import type { IdentitySync } from "./threads/identity-sync";
import type { ResumeController } from "./threads/resume-controller";
import type { SelectionActions } from "./threads/selection-actions";
import type { ChatViewRenderController } from "./panel/view-render-controller";
import type { ChatMessageRenderer } from "./ui/message-stream/renderer";
import type { ChatControllerCompositionPorts } from "./composition-ports";
import { createChatControllerCompositionActions } from "./composition-actions";
import {
  createChatServerActionControllers,
  createChatConnectionControllers,
  createChatInboundController,
  createChatReconnectControllerGroup,
} from "./connection/composition";
import { createThreadControllerGroup, createThreadSelectionActionGroup } from "./threads/composition";
import { createConversationSurfaceControllerGroup } from "./conversation/composition";
import {
  createConnectionLifecycleControllerGroup,
  createPanelUiControllerGroup,
  createViewRenderControllerGroup,
} from "./panel/composition";

export interface ChatViewControllers {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
    reconnect: ChatReconnectActions;
    scheduleWarmup: () => void;
  };
  inbound: {
    controller: ChatInboundController;
  };
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
  thread: {
    history: HistoryController;
    resume: ResumeController;
    actions: ChatThreadActions;
    restoration: RestorationController;
    identity: IdentitySync;
    rename: RenameController;
    autoTitle: AutoTitleController;
    selection: SelectionActions;
  };
  runtime: {
    settings: ChatRuntimeSettingsActions;
    goals: GoalActions;
  };
  requests: {
    pending: PendingRequestController;
  };
  toolbar: {
    panels: ToolbarPanelController;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmitActions;
  };
  render: {
    controller: ChatViewRenderController;
    messages: ChatMessageRenderer;
    openView: () => void;
    closeView: () => void;
    applyViewState: (state: unknown) => void;
  };
}

export function createChatViewControllers(ports: ChatControllerCompositionPorts): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup({
    plugin: {
      settings: ports.plugin.settings,
    },
    state: {
      stateStore: ports.state.stateStore,
    },
    lifecycle: {
      deferredTasks: ports.lifecycle.deferredTasks,
    },
    render: {
      panelRoot: ports.render.panelRoot,
      toolbarNode: ports.render.toolbarNode,
      goalNode: ports.render.goalNode,
      messagesNode: ports.render.messagesNode,
      composerNode: ports.render.composerNode,
    },
  });
  let connectionController: ChatConnectionController | null = null;
  let selection: SelectionActions | null = null;
  let composerController: ChatComposerController | null = null;
  const actions = createChatControllerCompositionActions(
    {
      state: ports.state,
      client: ports.client,
      render: ports.render,
      status: ports.status,
      scroll: ports.scroll,
      thread: ports.thread,
    },
    {
      renderController,
      ensureConnected: () => requireComposedController(connectionController, "connection controller").ensureConnected(),
      refreshThreads: () => requireComposedController(connectionController, "connection controller").refreshThreads(),
      refreshSkills: (forceReload) => requireComposedController(connectionController, "connection controller").refreshSkills(forceReload),
      selectThread: (threadId) => requireComposedController(selection, "selection actions").selectThread(threadId),
      setComposerText: (text) => {
        requireComposedController(composerController, "composer controller").setDraft(text, { focus: true });
      },
    },
  );
  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: ports.state.stateStore,
    currentClient: ports.client.getClient,
    runtimeSnapshotForState: ports.runtime.runtimeSnapshotForState,
    collaborationModeLabel: ports.runtime.collaborationModeLabel,
    addSystemMessage: actions.status.addSystemMessage,
  });
  const threadControllers = createThreadControllerGroup(
    {
      obsidian: {
        archiveAdapter: ports.obsidian.archiveAdapter,
      },
      plugin: {
        notifyThreadArchived: (threadId) => {
          ports.plugin.notifyThreadArchived(threadId);
        },
        notifyThreadRenamed: (threadId, name) => {
          ports.plugin.notifyThreadRenamed(threadId, name);
        },
        openThreadInNewView: (threadId) => ports.plugin.openThreadInNewView(threadId),
        refreshSharedThreadListFromOpenSurface: () => {
          ports.plugin.refreshSharedThreadListFromOpenSurface();
        },
        settings: ports.plugin.settings,
        vaultPath: ports.plugin.vaultPath,
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      client: actions.client,
      lifecycle: {
        deferredTasks: ports.lifecycle.deferredTasks,
        resumeWork: ports.lifecycle.resumeWork,
        getOpened: ports.lifecycle.getOpened,
        getClosing: ports.lifecycle.getClosing,
        clearDeferredRestoredThreadHydration: ports.lifecycle.clearDeferredRestoredThreadHydration,
      },
      render: actions.render,
      status: actions.status,
      thread: {
        selectThread: actions.thread.selectThread,
        refreshThreads: actions.thread.refreshThreads,
        notifyIdentityChanged: ports.thread.notifyIdentityChanged,
        refreshTabHeader: ports.thread.refreshTabHeader,
      },
      liveState: {
        refresh: ports.liveState.refresh,
      },
      scroll: actions.scroll,
      composer: actions.composer,
    },
    {
      connection,
    },
  );
  const { history, actions: threadActions, goals, identity, restoration, resume, rename, autoTitle } = threadControllers;
  const lifecycleActions = {
    deferredTasks: ports.lifecycle.deferredTasks,
    resumeWork: ports.lifecycle.resumeWork,
    connectionWork: ports.lifecycle.connectionWork,
    messageScrollIntent: ports.lifecycle.messageScrollIntent,
    getOpened: ports.lifecycle.getOpened,
    setOpened: ports.lifecycle.setOpened,
    getClosing: ports.lifecycle.getClosing,
    setClosing: ports.lifecycle.setClosing,
    invalidateConnectionWork: ports.lifecycle.invalidateConnectionWork,
    invalidateResumeWork: threadControllers.invalidateResumeWork,
    scheduleDeferredDiagnostics: ports.lifecycle.scheduleDeferredDiagnostics,
    clearDeferredDiagnostics: ports.lifecycle.clearDeferredDiagnostics,
    scheduleDeferredRestoredThreadHydration: ports.lifecycle.scheduleDeferredRestoredThreadHydration,
    clearDeferredRestoredThreadHydration: ports.lifecycle.clearDeferredRestoredThreadHydration,
    scheduleDeferredAppServerWarmup: ports.lifecycle.scheduleDeferredAppServerWarmup,
  };
  const { toolbarPanels, applyViewState } = createPanelUiControllerGroup(
    {
      state: {
        stateStore: ports.state.stateStore,
      },
      lifecycle: lifecycleActions,
      render: actions.render,
      thread: {
        restorePlaceholder: (restoredThreadState) => {
          restoration.restore(restoredThreadState);
        },
        clearRestoredLifecycle: () => {
          restoration.clear();
        },
      },
    },
    {
      threadActions,
    },
  );
  selection = createThreadSelectionActionGroup(
    {
      plugin: {
        focusThreadInOpenView: (threadId) => ports.plugin.focusThreadInOpenView(threadId),
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      thread: {
        resumeThread: (threadId) => resume.resumeThread(threadId),
      },
      status: actions.status,
    },
    {
      closeForThreadSelection: () => {
        toolbarPanels.closeForThreadSelection();
      },
    },
  ).selection;
  const { reconnectActions } = createChatReconnectControllerGroup(
    {
      state: {
        stateStore: ports.state.stateStore,
      },
      client: actions.client,
      lifecycle: lifecycleActions,
      render: actions.render,
      status: actions.status,
      thread: {
        resumeThread: (threadId) => resume.resumeThread(threadId),
      },
    },
    {
      connection,
    },
  );
  const serverActionControllers = createChatServerActionControllers(
    {
      plugin: {
        applyThreadListSnapshot: (threads) => {
          ports.plugin.applyThreadListSnapshot(threads);
        },
        publishAppServerMetadata: (metadata) => {
          ports.plugin.publishAppServerMetadata(metadata);
        },
        vaultPath: ports.plugin.vaultPath,
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      runtime: {
        runtimeSnapshotForState: ports.runtime.runtimeSnapshotForState,
      },
    },
    {
      connection,
      goals,
    },
  );
  const { serverThreads, serverMetadata, serverDiagnostics } = serverActionControllers;
  const serverRequestHost = {
    currentClient: ports.client.getClient,
  };
  const inboundController = createChatInboundController(
    {
      plugin: {
        notifyThreadArchived: (threadId) => {
          ports.plugin.notifyThreadArchived(threadId);
        },
        notifyThreadRenamed: (threadId, name) => {
          ports.plugin.notifyThreadRenamed(threadId, name);
        },
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      render: actions.render,
      thread: {
        refreshThreads: actions.thread.refreshThreads,
        refreshSkills: actions.thread.refreshSkills,
        publishAppServerMetadataSnapshot: () => {
          serverMetadata.publishAppServerMetadataSnapshot();
        },
      },
    },
    {
      serverMetadata,
      serverDiagnostics,
      autoTitle,
      respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
    },
  );
  connectionController = createChatConnectionControllers(
    {
      plugin: {
        publishAppServerIdentity: (userAgent) => {
          ports.plugin.publishAppServerIdentity(userAgent);
        },
        settings: ports.plugin.settings,
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      client: actions.client,
      lifecycle: lifecycleActions,
      thread: {
        loadSharedThreadList: ports.thread.loadSharedThreadList,
        refreshTabHeader: ports.thread.refreshTabHeader,
        resetTurnPresence: (hadTurns) => {
          autoTitle.resetThreadTurnPresence(hadTurns);
        },
      },
      status: actions.status,
      liveState: {
        refresh: ports.liveState.refresh,
      },
      render: actions.render,
    },
    {
      connection,
      serverMetadata,
      serverDiagnostics,
    },
  ).connectionController;

  connection.setHandlers({
    onNotification: (notification) => {
      inboundController.handleNotification(notification);
      ports.liveState.refresh();
      actions.render.schedule();
    },
    onServerRequest: (request) => {
      inboundController.handleServerRequest(request);
      ports.liveState.refresh();
      actions.render.now();
    },
    onLog: (message) => {
      inboundController.handleAppServerLog(message);
      actions.render.now();
    },
    onExit: () => {
      connectionController.handleExit();
    },
  });

  const conversationControllers = createConversationSurfaceControllerGroup(
    {
      obsidian: {
        app: ports.obsidian.app,
        owner: ports.obsidian.owner,
        viewId: ports.obsidian.viewId,
      },
      plugin: {
        openTurnDiff: (state) => ports.plugin.openTurnDiff(state),
        settings: ports.plugin.settings,
        vaultPath: ports.plugin.vaultPath,
      },
      state: {
        stateStore: ports.state.stateStore,
        getState: ports.state.getState,
      },
      client: actions.client,
      render: actions.render,
      runtime: {
        runtimeSnapshotForState: ports.runtime.runtimeSnapshotForState,
        statusSummaryLines: ports.runtime.statusSummaryLines,
        connectionDiagnosticDetails: ports.runtime.connectionDiagnosticDetails,
        modelStatusLines: ports.runtime.modelStatusLines,
        effortStatusLines: ports.runtime.effortStatusLines,
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: ports.thread.ensureRestoredThreadLoaded,
        startNewThread: ports.thread.startNewThread,
        selectThread: actions.thread.selectThread,
        notifyIdentityChanged: ports.thread.notifyIdentityChanged,
        resetTurnPresence: (hadTurns) => {
          autoTitle.resetThreadTurnPresence(hadTurns);
        },
      },
      status: actions.status,
      scroll: actions.scroll,
      lifecycle: {
        messageScrollIntent: ports.lifecycle.messageScrollIntent,
      },
      messages: {
        pendingRequestsSignature: ports.messages.pendingRequestsSignature,
      },
      composerView: {
        composerPlaceholder: ports.composerView.composerPlaceholder,
        composerMetaViewModel: ports.composerView.composerMetaViewModel,
      },
      liveState: {
        refresh: ports.liveState.refresh,
      },
    },
    {
      controller: inboundController,
      serverThreads,
      runtimeSettings,
      threadActions,
      reconnectActions,
      goals,
      history,
    },
  );
  const { pendingRequests, composerSubmit } = conversationControllers;
  const { messageRenderer } = conversationControllers;
  composerController = conversationControllers.composerController;
  const { scheduleAppServerWarmup, openView, closeView } = createConnectionLifecycleControllerGroup(
    {
      obsidian: {
        registerEvent: ports.obsidian.registerEvent,
        registerPointerDown: ports.obsidian.registerPointerDown,
      },
      plugin: {
        cachedThreadList: () => ports.plugin.cachedThreadList(),
        cachedAppServerMetadata: () => ports.plugin.cachedAppServerMetadata(),
      },
      client: {
        clear: actions.client.clear,
        ensureConnected: actions.client.ensureConnected,
      },
      lifecycle: {
        deferredTasks: lifecycleActions.deferredTasks,
        getOpened: lifecycleActions.getOpened,
        setOpened: lifecycleActions.setOpened,
        getClosing: lifecycleActions.getClosing,
        setClosing: lifecycleActions.setClosing,
        invalidateConnectionWork: lifecycleActions.invalidateConnectionWork,
        invalidateResumeWork: lifecycleActions.invalidateResumeWork,
        scheduleDeferredRestoredThreadHydration: lifecycleActions.scheduleDeferredRestoredThreadHydration,
        scheduleDeferredAppServerWarmup: lifecycleActions.scheduleDeferredAppServerWarmup,
      },
      render: {
        panelRoot: actions.render.panelRoot,
        closeToolbarPanelOnOutsidePointer: actions.render.closeToolbarPanelOnOutsidePointer,
        now: actions.render.now,
      },
      liveState: {
        refresh: ports.liveState.refresh,
        deferRefresh: ports.liveState.deferRefresh,
      },
    },
    {
      connection,
      composerController,
      messageRenderer,
      serverThreads,
      serverMetadata,
    },
  );

  return {
    connection: {
      manager: connection,
      controller: connectionController,
      reconnect: reconnectActions,
      scheduleWarmup: scheduleAppServerWarmup,
    },
    inbound: {
      controller: inboundController,
    },
    serverActions: {
      threads: serverThreads,
      metadata: serverMetadata,
      diagnostics: serverDiagnostics,
    },
    thread: {
      history,
      resume,
      actions: threadActions,
      restoration,
      identity,
      rename,
      autoTitle,
      selection,
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
      submission: composerSubmit,
    },
    render: {
      controller: renderController,
      messages: messageRenderer,
      openView,
      closeView,
      applyViewState,
    },
  };
}

function requireComposedController<T>(controller: T | null, name: string): T {
  if (!controller) throw new Error(`Chat view controller composition did not initialize ${name}.`);
  return controller;
}
