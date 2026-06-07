import { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatAppServerDiagnosticsController } from "../app-server/diagnostics-controller";
import type { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import type { ChatAppServerThreadController } from "../app-server/thread-controller";
import type { ChatComposerController } from "../composer/controller";
import type { ChatInboundController } from "../inbound/controller";
import type { ChatThreadGoalController } from "../controllers/thread/thread-goal-controller";
import type { ChatRuntimeSettingsController } from "../controllers/runtime/runtime-settings-controller";
import type { ChatThreadActionController } from "../controllers/thread/thread-actions-controller";
import type { ThreadHistoryController } from "../controllers/thread/thread-history-controller";
import type { ThreadRenameController } from "../controllers/thread/thread-rename-controller";
import type { ToolbarPanelController } from "./toolbar-controller";
import type { AppServerWarmupActions } from "../controllers/connection/app-server-warmup-controller";
import type { ChatConnectionController } from "../controllers/connection/connection-controller";
import type { ChatReconnectController } from "../controllers/connection/reconnect-controller";
import type { PendingRequestController } from "../controllers/requests/pending-request-controller";
import { ServerRequestResponder } from "../controllers/requests/server-request-responder";
import type { ComposerSubmissionController } from "../controllers/submission/composer-submission-controller";
import type { RestoredThreadController } from "../controllers/thread/restored-thread-controller";
import type { ThreadIdentityController } from "../controllers/thread/thread-identity-controller";
import type { ThreadResumeController } from "../controllers/thread/thread-resume-controller";
import type { ThreadSelectionActions } from "../controllers/thread/thread-selection-controller";
import type { ChatViewOpenCloseController } from "../controllers/view/view-open-close-controller";
import type { ChatViewRenderController } from "../controllers/view/view-render-controller";
import type { ChatViewStateActions } from "../controllers/view/view-state-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatPanelContext } from "./context";
import { createChatAppServerControllers, createChatConnectionControllers, createChatInboundController } from "./session-controllers";
import { createThreadControllerGroup } from "./thread-controllers";
import { createTurnControllerGroup } from "./turn-controllers";
import { createConnectionLifecycleControllerGroup, createViewRenderControllerGroup } from "./ui-controllers";

export interface ChatViewControllers {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
    reconnect: ChatReconnectController;
    warmup: AppServerWarmupActions;
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
    selection: ThreadSelectionActions;
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
    viewState: ChatViewStateActions;
  };
}

export function createChatViewControllers(ports: ChatPanelContext): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup(ports, { connection });
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
  } = createThreadControllerGroup(ports, {
    connection,
  });
  const { appServerThreads, appServerMetadata, appServerDiagnostics } = createChatAppServerControllers(ports, {
    connection,
    goals,
  });
  const serverRequestResponder = new ServerRequestResponder({
    currentClient: ports.client.getClient,
  });
  const controller = createChatInboundController(ports, {
    appServerMetadata,
    appServerDiagnostics,
    threadRename,
    serverRequestResponder,
  });
  const { connectionController } = createChatConnectionControllers(ports, {
    connection,
    appServerMetadata,
    appServerDiagnostics,
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

  const { pendingRequests, messageRenderer, composerController, composerSubmission } = createTurnControllerGroup(ports, {
    controller,
    appServerThreads,
    runtimeSettings,
    threadActions,
    threadRename,
    reconnectActions,
    goals,
    history,
  });
  const { appServerWarmup, openCloseController } = createConnectionLifecycleControllerGroup(ports, {
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
