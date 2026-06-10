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
import { createChatControllerCompositionActions, requireCompositionRef, type ChatControllerCompositionRefs } from "./controller-wiring";
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
  const refs: ChatControllerCompositionRefs = {
    renderController,
    controller: null,
    connectionController: null,
    threadSelection: null,
    threadRename: null,
    threadResume: null,
    restoredThread: null,
    serverMetadata: null,
    serverDiagnostics: null,
    messageRenderer: null,
    composerController: null,
  };
  const actions = createChatControllerCompositionActions(ports, refs);
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
  refs.restoredThread = threadControllers.restoredThread;
  refs.threadResume = threadControllers.threadResume;
  refs.threadRename = threadControllers.threadRename;
  const threadRename = requireCompositionRef(refs.threadRename, "thread rename controller");
  const lifecycleActions = {
    ...ports.lifecycle,
    invalidateResumeWork: threadControllers.invalidateResumeWork,
  };
  const { toolbarPanels, applyViewState } = createPanelUiControllerGroup(
    {
      ...ports,
      lifecycle: lifecycleActions,
      render: actions.render,
      thread: actions.thread,
    },
    {
      threadActions,
    },
  );
  refs.threadSelection = createThreadSelectionControllerGroup(
    {
      ...ports,
      thread: actions.thread,
      status: actions.status,
    },
    {
      toolbarPanels,
    },
  ).threadSelection;
  const { reconnectActions } = createChatReconnectControllerGroup(
    {
      ...ports,
      client: actions.client,
      lifecycle: lifecycleActions,
      render: actions.render,
      status: actions.status,
      thread: actions.thread,
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
  refs.serverMetadata = serverMetadata;
  refs.serverDiagnostics = serverDiagnostics;
  const serverRequestHost = {
    currentClient: ports.client.getClient,
  };
  refs.controller = createChatInboundController(
    {
      ...ports,
      render: actions.render,
      thread: actions.thread,
    },
    {
      serverMetadata,
      serverDiagnostics,
      threadRename,
      respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
    },
  );
  refs.connectionController = createChatConnectionControllers(
    {
      ...ports,
      client: actions.client,
      lifecycle: lifecycleActions,
      thread: actions.thread,
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
  const inboundController = requireCompositionRef(refs.controller, "inbound controller");
  const connectionController = requireCompositionRef(refs.connectionController, "connection controller");

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
      runtime: actions.runtime,
      thread: actions.thread,
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
  refs.messageRenderer = conversationControllers.messageRenderer;
  refs.composerController = conversationControllers.composerController;
  const messageRenderer = requireCompositionRef(refs.messageRenderer, "message renderer");
  const composerController = requireCompositionRef(refs.composerController, "composer controller");
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
  const threadResume = requireCompositionRef(refs.threadResume, "thread resume controller");
  const restoredThread = requireCompositionRef(refs.restoredThread, "restored thread controller");
  const threadSelection = requireCompositionRef(refs.threadSelection, "thread selection controller");

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
