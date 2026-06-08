import { ConnectionManager } from "../../../app-server/connection-manager";
import type { ChatAppServerDiagnosticsActions } from "../app-server/diagnostics-actions";
import type { ChatAppServerMetadataActions } from "../app-server/metadata-actions";
import type { ChatAppServerThreadActions } from "../app-server/thread-actions";
import type { ChatComposerController } from "../composer/controller";
import type { ChatInboundController } from "../inbound/controller";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import type { ChatRuntimeSettingsActions } from "../runtime/runtime-settings-actions";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ThreadHistoryController } from "../threads/thread-history-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import type { ToolbarPanelController } from "./toolbar-controller";
import type { AppServerWarmupActions } from "../session/app-server-warmup-controller";
import type { ChatConnectionController } from "../session/connection-controller";
import type { ChatReconnectActions } from "../session/reconnect-actions";
import type { PendingRequestController } from "../requests/pending-request-controller";
import { createServerRequestActions } from "../requests/server-request-actions";
import type { ComposerSubmissionActions } from "../turns/composer-submission-actions";
import type { RestoredThreadController } from "../threads/restored-thread-controller";
import type { ThreadIdentityActions } from "../threads/thread-identity-actions";
import type { ThreadResumeController } from "../threads/thread-resume-controller";
import type { ThreadSelectionActions } from "../threads/thread-selection-controller";
import type { ChatViewOpenCloseActions } from "./open-close-actions";
import type { ChatViewRenderController } from "./view-render-controller";
import type { ChatViewStateActions } from "./view-state-controller";
import type { ChatMessageRenderer } from "../ui/message-stream";
import type { ChatPanelContext } from "./context";
import {
  createChatAppServerControllers,
  createChatConnectionControllers,
  createChatInboundController,
  createChatReconnectControllerGroup,
} from "../session/composition";
import { createChatRuntimeControllerGroup } from "../runtime/composition";
import { createThreadControllerGroup, createThreadSelectionControllerGroup } from "../threads/composition";
import { createConversationSurfaceControllerGroup } from "../turns/composition";
import { createConnectionLifecycleControllerGroup, createPanelUiControllerGroup, createViewRenderControllerGroup } from "./ui-composition";

export interface ChatViewControllers {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
    reconnect: ChatReconnectActions;
    warmup: AppServerWarmupActions;
  };
  inbound: {
    controller: ChatInboundController;
  };
  appServer: {
    threads: ChatAppServerThreadActions;
    metadata: ChatAppServerMetadataActions;
    diagnostics: ChatAppServerDiagnosticsActions;
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
    openClose: ChatViewOpenCloseActions;
    viewState: ChatViewStateActions;
  };
}

export function createChatViewControllers(ports: ChatPanelContext): ChatViewControllers {
  const connection = new ConnectionManager(() => ports.plugin.settings.codexPath, ports.plugin.vaultPath);
  const { renderController } = createViewRenderControllerGroup(ports, { connection });
  const { runtimeSettings } = createChatRuntimeControllerGroup(ports);
  const { history, threadActions, goals, restoredThread, threadResume, threadIdentity, threadRename } = createThreadControllerGroup(ports, {
    connection,
  });
  const { toolbarPanels, viewStateController } = createPanelUiControllerGroup(ports, {
    threadActions,
  });
  const { threadSelection } = createThreadSelectionControllerGroup(ports, {
    toolbarPanels,
  });
  const { reconnectActions } = createChatReconnectControllerGroup(ports, {
    connection,
  });
  const { appServerThreads, appServerMetadata, appServerDiagnostics } = createChatAppServerControllers(ports, {
    connection,
    goals,
  });
  const serverRequestResponder = createServerRequestActions({
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

  const { pendingRequests, messageRenderer, composerController, composerSubmission } = createConversationSurfaceControllerGroup(ports, {
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
