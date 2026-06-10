import { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatServerDiagnosticsActions } from "../server-actions/diagnostics-actions";
import type { ChatServerMetadataActions } from "../server-actions/metadata-actions";
import type { ChatServerThreadActions } from "../server-actions/thread-actions";
import type { ChatComposerController } from "../composer/controller";
import type { ChatInboundController } from "../inbound/controller";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import { createChatRuntimeSettingsActions, type ChatRuntimeSettingsActions } from "../runtime/runtime-settings-actions";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ThreadHistoryController } from "../threads/thread-history-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ToolbarPanelController } from "./toolbar-controller";
import type { ChatConnectionController } from "../session/connection-controller";
import type { ChatReconnectActions } from "../session/reconnect-actions";
import type { PendingRequestController } from "../requests/pending-request-controller";
import { rejectServerRequest, respondToServerRequest } from "../requests/server-request-responder";
import type { ComposerSubmissionActions } from "../turns/composer-submission-actions";
import type { RestoredThreadController } from "../threads/restored-thread-controller";
import type { ThreadIdentityActions } from "../threads/thread-identity-actions";
import type { ThreadResumeController } from "../threads/thread-resume-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatViewRenderController, ChatViewSlotRenderers } from "./view-render-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatControllerCompositionPorts } from "./controller-ports";
import { createChatControllerCompositionActions, type ChatControllerCompositionBridges } from "./controller-wiring";
import {
  createChatServerActionControllers,
  createChatConnectionControllers,
  createChatInboundController,
  createChatReconnectControllerGroup,
} from "../session/composition";
import { createThreadControllerGroup, createThreadSelectionControllerGroup } from "../threads/composition";
import { createConversationSurfaceControllerGroup } from "../turns/composition";
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
    attachSlotRenderers: (slotRenderers: ChatViewSlotRenderers) => void;
    openView: () => void;
    closeView: () => void;
    applyViewState: (state: unknown) => void;
  };
}

export function createChatViewControllers(ports: ChatControllerCompositionPorts): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup(ports, { connection });
  const bridges: ChatControllerCompositionBridges = {
    systemMessages: { controller: null },
    connection: { controller: null },
    threadSelection: { actions: null },
    messageViewport: { renderer: null },
    composerDraft: { controller: null },
  };
  const actions = createChatControllerCompositionActions(ports, { renderController, bridges });
  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: ports.state.stateStore,
    currentClient: ports.client.getClient,
    runtimeSnapshot: ports.runtime.runtimeSnapshot,
    collaborationModeLabel: ports.runtime.collaborationModeLabel,
    addSystemMessage: actions.status.addSystemMessage,
  });
  const threadControllers = createThreadControllerGroup(
    {
      ...ports,
      client: actions.client,
      render: actions.render,
      status: actions.status,
      thread: actions.thread,
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
    ...ports.lifecycle,
    invalidateResumeWork: threadControllers.invalidateResumeWork,
  };
  const { toolbarPanels, applyViewState } = createPanelUiControllerGroup(
    {
      ...ports,
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
      ...ports,
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
      ...ports,
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
      ...ports,
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
  bridges.systemMessages.controller = inboundController;
  const connectionController = createChatConnectionControllers(
    {
      ...ports,
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
      liveState: ports.liveState,
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
      ...ports,
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
  bridges.messageViewport.renderer = messageRenderer;
  bridges.composerDraft.controller = composerController;
  const { scheduleAppServerWarmup, openView, closeView } = createConnectionLifecycleControllerGroup(
    {
      ...ports,
      client: actions.client,
      lifecycle: lifecycleActions,
      render: actions.render,
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
      attachSlotRenderers: (slotRenderers) => {
        renderController.setSlotRenderers(slotRenderers);
      },
      openView,
      closeView,
      applyViewState,
    },
  };
}
