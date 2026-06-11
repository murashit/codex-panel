import { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatServerDiagnosticsActions } from "../protocol/client-actions/diagnostics-actions";
import type { ChatServerMetadataActions } from "../protocol/client-actions/metadata-actions";
import type { ChatServerThreadActions } from "../protocol/client-actions/thread-actions";
import type { ChatComposerController } from "../conversation/composer/controller";
import type { ChatInboundController } from "../protocol/inbound/controller";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import { createChatRuntimeSettingsActions, type ChatRuntimeSettingsActions } from "../runtime/runtime-settings-actions";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ThreadHistoryController } from "../threads/thread-history-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ToolbarPanelController } from "./toolbar-controller";
import type { ChatConnectionController } from "../connection/connection-controller";
import type { ChatReconnectActions } from "../connection/reconnect-actions";
import type { PendingRequestController } from "../pending-requests/controller";
import { rejectServerRequest, respondToServerRequest } from "../protocol/requests/server-request-responder";
import type { ComposerSubmissionActions } from "../conversation/turns/composer-submission-actions";
import type { RestoredThreadController } from "../threads/restored-thread-controller";
import type { ThreadIdentityActions } from "../threads/thread-identity-actions";
import type { ThreadResumeController } from "../threads/thread-resume-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatViewRenderController } from "./view-render-controller";
import type { ChatMessageRenderer } from "../ui/message-stream/renderer";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import { createChatControllerCompositionActions, type ChatControllerCompositionBridges } from "./controller-wiring";
import {
  createChatServerActionControllers,
  createChatConnectionControllers,
  createChatInboundController,
  createChatReconnectControllerGroup,
} from "../connection/composition";
import { createThreadControllerGroup, createThreadSelectionControllerGroup } from "../threads/composition";
import { createConversationSurfaceControllerGroup } from "../conversation/turns/composition";
import { createConnectionLifecycleControllerGroup, createPanelUiControllerGroup, createViewRenderControllerGroup } from "./ui-composition";

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
    history: ThreadHistoryController;
    resume: ThreadResumeController;
    actions: ChatThreadActions;
    restored: RestoredThreadController;
    identity: ThreadIdentityActions;
    rename: ThreadRenameController;
    selection: ThreadSelectionActions;
  };
  runtime: {
    settings: ChatRuntimeSettingsActions;
    goals: ChatThreadGoalActions;
  };
  requests: {
    pending: PendingRequestController;
  };
  toolbar: {
    panels: ToolbarPanelController;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmissionActions;
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
  const bridges: ChatControllerCompositionBridges = {
    connection: { controller: null },
    threadSelection: { actions: null },
    composerDraft: { controller: null },
  };
  const actions = createChatControllerCompositionActions(
    {
      state: ports.state,
      client: ports.client,
      render: ports.render,
      status: ports.status,
      scroll: ports.scroll,
      thread: ports.thread,
      runtime: ports.runtime,
    },
    { renderController, bridges },
  );
  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: ports.state.stateStore,
    currentClient: ports.client.getClient,
    runtimeSnapshot: ports.runtime.runtimeSnapshot,
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
  const { history, threadActions, goals, threadIdentity } = threadControllers;
  const { restoredThread, threadResume, threadRename } = threadControllers;
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
          restoredThread.restore(restoredThreadState);
        },
        clearRestoredLifecycle: () => {
          restoredThread.clear();
        },
      },
    },
    {
      threadActions,
    },
  );
  const threadSelection = createThreadSelectionControllerGroup(
    {
      plugin: {
        focusThreadInOpenView: (threadId) => ports.plugin.focusThreadInOpenView(threadId),
      },
      state: {
        stateStore: ports.state.stateStore,
      },
      thread: {
        resumeThread: (threadId) => threadResume.resumeThread(threadId),
      },
      status: actions.status,
    },
    {
      toolbarPanels,
    },
  ).threadSelection;
  bridges.threadSelection.actions = threadSelection;
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
        resumeThread: (threadId) => threadResume.resumeThread(threadId),
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
        runtimeSnapshot: ports.runtime.runtimeSnapshot,
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
      threadRename,
      respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
    },
  );
  const connectionController = createChatConnectionControllers(
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
          threadRename.resetThreadTurnPresence(hadTurns);
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
  bridges.connection.controller = connectionController;

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
        ...actions.runtime,
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ensureRestoredThreadLoaded: ports.thread.ensureRestoredThreadLoaded,
        startNewThread: ports.thread.startNewThread,
        selectThread: actions.thread.selectThread,
        notifyIdentityChanged: ports.thread.notifyIdentityChanged,
        resetTurnPresence: (hadTurns) => {
          threadRename.resetThreadTurnPresence(hadTurns);
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
      threadRename,
      reconnectActions,
      goals,
      history,
    },
  );
  const { pendingRequests, composerSubmission } = conversationControllers;
  const { messageRenderer, composerController } = conversationControllers;
  bridges.composerDraft.controller = composerController;
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
      openView,
      closeView,
      applyViewState,
    },
  };
}
