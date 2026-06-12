import { ConnectionManager } from "../../app-server/connection/connection-manager";
import type { ChatServerDiagnosticsActions } from "./connection/server-actions/diagnostics";
import type { ChatServerMetadataActions } from "./connection/server-actions/metadata";
import type { ChatServerThreadActions } from "./connection/server-actions/threads";
import type { ChatComposerController } from "./conversation/composer/controller";
import type { ChatInboundController } from "./protocol/inbound/controller";
import type { GoalActions } from "./threads/goal-actions";
import { createChatRuntimeSettingsActions, type ChatRuntimeSettingsActions } from "./runtime/settings-actions";
import type { ChatThreadActions } from "./threads/action-context";
import type { AutoTitleController } from "./threads/auto-title-controller";
import type { HistoryController } from "./threads/history-controller";
import type { RenameController } from "./threads/rename-controller";
import type { ToolbarPanelActions } from "./panel/regions/toolbar";
import type { ChatConnectionController } from "./connection/connection-controller";
import type { ChatReconnectActions } from "./connection/reconnect-actions";
import type { PendingRequestController } from "./conversation/pending-requests/controller";
import type { DisplayDetailSection } from "./display/types";
import { rejectServerRequest, respondToServerRequest } from "./protocol/server-requests/responder";
import type { ComposerSubmitActions } from "./conversation/turns/composer-submit-actions";
import type { RestorationController } from "./threads/restoration-controller";
import type { IdentitySync } from "./threads/identity-sync";
import type { ResumeController } from "./threads/resume-controller";
import type { SelectionActions } from "./threads/selection-actions";
import type { MessageStreamRenderer } from "./ui/message-stream/renderer";
import type { ChatControllerCompositionPorts } from "./composition-ports";
import { scheduleAppServerWarmup } from "./connection/app-server-warmup";
import { runtimeSnapshotForChatState } from "./runtime/snapshot";
import {
  createChatServerActionControllers,
  createChatConnectionControllers,
  createChatInboundController,
  createChatReconnectControllerGroup,
} from "./connection/composition";
import { createThreadControllerGroup, createThreadSelectionActionGroup } from "./threads/composition";
import { createConversationSurfaceControllerGroup } from "./conversation/composition";
import { createChatViewRenderer, createConnectionLifecycleControllerGroup, createPanelUiControllerGroup } from "./panel/composition";

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
    panels: ToolbarPanelActions;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmitActions;
  };
  render: {
    now: () => void;
    messageStream: MessageStreamRenderer;
    openView: () => void;
    closeView: () => void;
    applyViewState: (state: unknown) => void;
  };
}

interface ChatCompositionSideEffects {
  render: Pick<ChatControllerCompositionPorts["render"], "panelRoot" | "closeToolbarPanelOnOutsidePointer" | "schedule"> & {
    now: () => void;
  };
  status: ChatControllerCompositionPorts["status"] & {
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatViewControllers(ports: ChatControllerCompositionPorts): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const renderNow = createChatViewRenderer(ports);
  let connectionController: ChatConnectionController | null = null;
  let selection: SelectionActions | null = null;
  let composerController: ChatComposerController | null = null;
  const ensureConnected = () => requireComposedController(connectionController, "connection controller").ensureConnected();
  const refreshThreads = () => requireComposedController(connectionController, "connection controller").refreshThreads();
  const refreshSkills = (forceReload?: boolean) =>
    requireComposedController(connectionController, "connection controller").refreshSkills(forceReload);
  const selectThread = (threadId: string) => requireComposedController(selection, "selection actions").selectThread(threadId);
  const sideEffects = createChatCompositionSideEffects(ports, {
    renderNow,
    setComposerText: (text) => {
      requireComposedController(composerController, "composer controller").setDraft(text, { focus: true });
    },
  });
  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: ports.state.stateStore,
    currentClient: ports.client.getClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    collaborationModeLabel: ports.runtime.collaborationModeLabel,
    addSystemMessage: sideEffects.status.addSystemMessage,
  });
  const scheduleWarmup = () => {
    scheduleAppServerWarmup({
      deferredTasks: ports.lifecycle.deferredTasks,
      opened: ports.lifecycle.getOpened,
      closing: ports.lifecycle.getClosing,
      connected: () => connection.isConnected(),
      ensureConnected,
    });
  };
  const threadControllers = createThreadControllerGroup(
    {
      ...ports,
      client: {
        getClient: ports.client.getClient,
        ensureConnected,
      },
      render: sideEffects.render,
      status: sideEffects.status,
      thread: {
        ...ports.thread,
        selectThread,
        refreshThreads,
      },
      scroll: ports.scroll,
      composer: sideEffects.composer,
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
    invalidateConnectionWork: () => {
      ports.lifecycle.connectionWork.invalidate();
    },
    invalidateResumeWork: threadControllers.invalidateResumeWork,
    scheduleDeferredDiagnostics: () => {
      ports.lifecycle.deferredTasks.scheduleDiagnostics(() => {
        void ports.lifecycle.refreshDeferredDiagnostics();
      });
    },
    clearDeferredDiagnostics: () => {
      ports.lifecycle.deferredTasks.clearDiagnostics();
    },
    scheduleDeferredRestoredThreadHydration: () => {
      restoration.scheduleHydration();
    },
    clearDeferredRestoredThreadHydration: () => {
      restoration.clearHydration();
    },
    scheduleDeferredAppServerWarmup: () => {
      scheduleWarmup();
    },
  };
  const { toolbarPanels, applyViewState } = createPanelUiControllerGroup(
    {
      state: ports.state,
      lifecycle: lifecycleActions,
      render: sideEffects.render,
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
      plugin: ports.plugin,
      state: ports.state,
      thread: {
        resumeThread: (threadId) => resume.resumeThread(threadId),
      },
      status: sideEffects.status,
    },
    {
      closeForThreadSelection: () => {
        toolbarPanels.closeForThreadSelection();
      },
    },
  ).selection;
  const { reconnectActions } = createChatReconnectControllerGroup(
    {
      state: ports.state,
      client: {
        clear: ports.client.clear,
        ensureConnected,
      },
      lifecycle: lifecycleActions,
      render: sideEffects.render,
      status: sideEffects.status,
      thread: {
        resumeThread: (threadId) => resume.resumeThread(threadId),
      },
    },
    {
      connection,
    },
  );
  const serverActionControllers = createChatServerActionControllers(ports, {
    connection,
    goals,
  });
  const { serverThreads, serverMetadata, serverDiagnostics } = serverActionControllers;
  const serverRequestHost = {
    currentClient: ports.client.getClient,
  };
  const inboundController = createChatInboundController(
    {
      plugin: ports.plugin,
      state: ports.state,
      render: sideEffects.render,
      thread: {
        refreshThreads,
        refreshSkills,
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
      plugin: ports.plugin,
      state: ports.state,
      client: {
        setClient: ports.client.setClient,
      },
      lifecycle: lifecycleActions,
      thread: {
        loadSharedThreadList: ports.thread.loadSharedThreadList,
        refreshTabHeader: ports.thread.refreshTabHeader,
        resetTurnPresence: (hadTurns) => {
          autoTitle.resetThreadTurnPresence(hadTurns);
        },
      },
      status: sideEffects.status,
      liveState: ports.liveState,
      render: sideEffects.render,
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
      sideEffects.render.schedule();
    },
    onServerRequest: (request) => {
      inboundController.handleServerRequest(request);
      ports.liveState.refresh();
      sideEffects.render.now();
    },
    onLog: (message) => {
      inboundController.handleAppServerLog(message);
      sideEffects.render.now();
    },
    onExit: () => {
      connectionController.handleExit();
    },
  });

  const conversationControllers = createConversationSurfaceControllerGroup(
    {
      ...ports,
      client: {
        getClient: ports.client.getClient,
        ensureConnected,
      },
      render: sideEffects.render,
      runtime: {
        ...ports.runtime,
        mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
      },
      thread: {
        ...ports.thread,
        selectThread,
        resetTurnPresence: (hadTurns) => {
          autoTitle.resetThreadTurnPresence(hadTurns);
        },
      },
      status: sideEffects.status,
      scroll: ports.scroll,
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
  const { messageStreamRenderer } = conversationControllers;
  composerController = conversationControllers.composerController;
  const lifecycleControllers = createConnectionLifecycleControllerGroup(
    {
      ...ports,
      client: {
        clear: ports.client.clear,
      },
      lifecycle: lifecycleActions,
      render: sideEffects.render,
    },
    {
      connection,
      composerController,
      messageStreamRenderer,
      serverThreads,
      serverMetadata,
    },
  );

  return {
    connection: {
      manager: connection,
      controller: connectionController,
      reconnect: reconnectActions,
      scheduleWarmup,
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
      now: sideEffects.render.now,
      messageStream: messageStreamRenderer,
      openView: lifecycleControllers.openView,
      closeView: lifecycleControllers.closeView,
      applyViewState,
    },
  };
}

function requireComposedController<T>(controller: T | null, name: string): T {
  if (!controller) throw new Error(`Chat view controller composition did not initialize ${name}.`);
  return controller;
}

function createChatCompositionSideEffects(
  ports: Pick<ChatControllerCompositionPorts, "render" | "state" | "status">,
  deps: {
    renderNow: () => void;
    setComposerText: (text: string) => void;
  },
): ChatCompositionSideEffects {
  const render = {
    panelRoot: ports.render.panelRoot,
    closeToolbarPanelOnOutsidePointer: ports.render.closeToolbarPanelOnOutsidePointer,
    schedule: ports.render.schedule,
    now: () => {
      deps.renderNow();
    },
  };
  const status = {
    set: ports.status.set,
    addSystemMessage: (text: string) => {
      ports.state.stateStore.dispatch({ type: "message-stream/system-item-added", item: ports.state.systemItem(text) });
      render.now();
    },
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => {
      ports.state.stateStore.dispatch({
        type: "message-stream/system-item-added",
        item: ports.state.structuredSystemItem(text, details),
      });
      render.now();
    },
  };

  return {
    render,
    status,
    composer: {
      setText: (text) => {
        deps.setComposerText(text);
        render.now();
      },
    },
  };
}
