import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { ConversationTurnActions } from "../application/conversation/composition";
import type { PendingRequestActions } from "../application/pending-requests/pending-request-actions";
import type { ChatStateStore } from "../application/state/store";
import type { createGoalActions } from "../application/threads/goal-actions";
import type { HistoryController } from "../application/threads/history-controller";
import type { ThreadRenameEditorActions } from "../application/threads/rename-editor-actions";
import type { createThreadManagementActions } from "../application/threads/thread-management-actions";
import type { createThreadNavigationActions } from "../application/threads/thread-navigation-actions";
import type { ChatPanelGoalSurface } from "../panel/surface/goal-projection";
import { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import type { ChatMessageScrollController } from "../panel/surface/message-stream-scroll";
import type { ChatPanelToolbarSurface } from "../panel/surface/toolbar-projection";
import { createChatPanelToolbarActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ToolbarActions } from "../ui/toolbar";
import type { ChatPanelConnectionBundle } from "./connection-bundle";
import type { ChatPanelEnvironment } from "./environment";

type ChatPanelGoalActions = ReturnType<typeof createGoalActions>;
type ChatPanelThreadActions = ReturnType<typeof createThreadManagementActions>;
type ChatPanelThreadNavigationActions = ReturnType<typeof createThreadNavigationActions>;
type ChatPanelConversationTurnActions = ConversationTurnActions;

export interface ChatPanelSurfacesHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  messageScrollController: ChatMessageScrollController;
}

export interface ChatPanelSurfacesInput {
  connection: ConnectionManager;
  connectionController: ChatPanelConnectionBundle["connection"]["controller"];
  goals: ChatPanelGoalActions;
  rename: ThreadRenameEditorActions;
  threadActions: ChatPanelThreadActions;
  toolbarPanels: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationActions;
  reconnect: () => Promise<void>;
  history: HistoryController;
  pendingRequests: PendingRequestActions;
  turnActions: ChatPanelConversationTurnActions;
}

export interface ChatPanelSurfaces {
  toolbarActions: ToolbarActions;
  toolbarSurface: ChatPanelToolbarSurface;
  goalSurface: ChatPanelGoalSurface;
  messageStreamPresenter: MessageStreamPresenter;
}

export function createChatPanelSurfaces(host: ChatPanelSurfacesHost, input: ChatPanelSurfacesInput): ChatPanelSurfaces {
  const {
    connection,
    connectionController,
    goals,
    rename,
    threadActions,
    toolbarPanels,
    navigation,
    reconnect,
    history,
    pendingRequests,
    turnActions,
  } = input;
  const { environment, stateStore } = host;
  const toolbarActions = createChatPanelToolbarActions({
    connectionController,
    reconnectPanel: reconnect,
    threadActions,
    goals,
    toolbarPanels,
    rename,
    navigation,
  });
  const toolbarSurface: ChatPanelToolbarSurface = {
    state: {
      connected: () => connection.isConnected(),
      nowMs: () => Date.now(),
    },
    settings: {
      vaultPath: () => environment.plugin.settingsRef.vaultPath,
      configuredCommand: () => environment.plugin.settingsRef.settings.codexPath,
      archiveExportEnabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled,
    },
  };
  const goalSurface: ChatPanelGoalSurface = {
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut,
    actions: goals,
  };
  const messageStreamPresenter = new MessageStreamPresenter({
    obsidian: {
      app: environment.obsidian.app,
      owner: environment.obsidian.owner,
    },
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: environment.plugin.settingsRef.vaultPath,
    },
    scroll: {
      controller: host.messageScrollController,
      dispose: () => {
        host.messageScrollController.dispose();
      },
    },
    history: {
      loadOlderTurns: () => void history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turnActions.planImplementation.implement(itemId),
      openTurnDiff: (state) => void environment.plugin.workspace.openTurnDiff(state),
    },
    requests: {
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });

  return {
    toolbarActions,
    toolbarSurface,
    goalSurface,
    messageStreamPresenter,
  };
}
