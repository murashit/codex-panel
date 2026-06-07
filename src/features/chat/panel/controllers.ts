import { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatAppServerDiagnosticsController } from "../app-server/diagnostics-controller";
import type { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import type { ChatAppServerThreadController } from "../app-server/thread-controller";
import type { ChatComposerController } from "../composer/controller";
import type { ChatInboundController } from "../inbound/controller";
import type { ChatThreadGoalController } from "../threads/thread-goal-controller";
import type { ChatRuntimeSettingsController } from "../runtime/runtime-settings-controller";
import type { ChatThreadActionController } from "../threads/thread-actions-controller";
import type { ThreadHistoryController } from "../threads/thread-history-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ToolbarPanelController } from "./toolbar-controller";
import type { AppServerWarmupActions } from "../session/app-server-warmup-controller";
import type { ChatConnectionController } from "../session/connection-controller";
import type { ChatReconnectController } from "../session/reconnect-controller";
import type { PendingRequestController } from "../requests/pending-request-controller";
import { ServerRequestResponder } from "../requests/server-request-responder";
import type { ComposerSubmissionController } from "../turns/composer-submission-controller";
import type { RestoredThreadController } from "../threads/restored-thread-controller";
import type { ThreadIdentityController } from "../threads/thread-identity-controller";
import type { ThreadResumeController } from "../threads/thread-resume-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatViewOpenCloseController } from "./view-open-close-controller";
import type { ChatViewRenderController } from "./view-render-controller";
import type { ChatViewStateActions } from "./view-state-controller";
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
