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
import type { ChatViewRenderController } from "./view-render-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatControllerCompositionPorts } from "./controller-ports";
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
    openView: () => void;
    closeView: () => void;
    applyViewState: (state: unknown) => void;
  };
}

export function createChatViewControllers(ports: ChatControllerCompositionPorts): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup(ports, { connection });
  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: ports.state.stateStore,
    currentClient: ports.client.getClient,
    runtimeSnapshot: ports.runtime.runtimeSnapshot,
    collaborationModeLabel: ports.runtime.collaborationModeLabel,
    addSystemMessage: ports.status.addSystemMessage,
  });
  const { history, threadActions, goals, restoredThread, threadResume, threadIdentity, threadRename } = createThreadControllerGroup(ports, {
    connection,
  });
  const { toolbarPanels, applyViewState } = createPanelUiControllerGroup(ports, {
    threadActions,
  });
  const { threadSelection } = createThreadSelectionControllerGroup(ports, {
    toolbarPanels,
  });
  const { reconnectActions } = createChatReconnectControllerGroup(ports, {
    connection,
  });
  const { serverThreads, serverMetadata, serverDiagnostics } = createChatServerActionControllers(ports, {
    connection,
    goals,
  });
  const serverRequestHost = {
    currentClient: ports.client.getClient,
  };
  const controller = createChatInboundController(ports, {
    serverMetadata,
    serverDiagnostics,
    threadRename,
    respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
    rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
  });
  const { connectionController } = createChatConnectionControllers(ports, {
    connection,
    serverMetadata,
    serverDiagnostics,
  });

  connection.setHandlers({
    onNotification: (notification) => {
      controller.handleNotification(notification);
      ports.liveState.refresh();
      ports.render.schedule();
    },
    onServerRequest: (request) => {
      controller.handleServerRequest(request);
      ports.liveState.refresh();
      ports.render.now();
    },
    onLog: (message) => {
      controller.handleAppServerLog(message);
      ports.render.now();
    },
    onExit: () => {
      connectionController.handleExit();
    },
  });

  const { pendingRequests, messageRenderer, composerController, composerSubmission } = createConversationSurfaceControllerGroup(ports, {
    controller,
    serverThreads,
    runtimeSettings,
    threadActions,
    threadRename,
    reconnectActions,
    goals,
    history,
  });
  const { scheduleAppServerWarmup, openView, closeView } = createConnectionLifecycleControllerGroup(ports, {
    connection,
    composerController,
    messageRenderer,
    serverThreads,
    serverMetadata,
  });

  return {
    connection: {
      manager: connection,
      controller: connectionController,
      reconnect: reconnectActions,
      scheduleWarmup: scheduleAppServerWarmup,
    },
    inbound: {
      controller,
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
