import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import type { PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import { activeThreadId } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { HistoryController } from "../../application/threads/history-controller";
import type { ThreadRenameEditorActions } from "../../application/threads/rename-editor-actions";
import type { ChatComposerController } from "../../panel/composer/controller";
import type { ChatPanelGoalDependencies } from "../../panel/goal/view-projection";
import type { ChatPanelShellParts } from "../../panel/shell/render.dom";
import { createChatThreadStreamDependencies } from "../../panel/thread-stream/context.obsidian";
import type { ChatThreadStreamScrollBinding } from "../../panel/thread-stream/scroll-binding";
import { createToolbarUiActions, type ToolbarPanelActions } from "../../panel/toolbar/actions";
import { toolbarOutsidePointerHit } from "../../panel/toolbar/hit-test.dom";
import type { ChatPanelToolbarDependencies } from "../../panel/toolbar/view-projection";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatPanelConnectionBundle } from "./connection-bundle";
import type { ChatPanelGoalCommands, ChatPanelThreadCommands, ChatPanelThreadNavigationCommands } from "./thread-bundle";
import type { ChatPanelTurnBundle } from "./turn-bundle";

interface ChatPanelShellBundleHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: ChatThreadStreamScrollBinding;
}

interface ChatPanelShellBundleInput {
  connection: ConnectionManager;
  connectionCoordinator: ChatPanelConnectionBundle["connection"]["coordinator"];
  goals: ChatPanelGoalCommands;
  rename: ThreadRenameEditorActions;
  threadCommands: ChatPanelThreadCommands;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationCommands;
  reconnect: () => Promise<void>;
  history: HistoryController;
  pendingRequests: PendingRequestActions;
  turn: ChatPanelTurnBundle;
  composerController: ChatComposerController;
}

export interface ChatPanelShellBundle {
  parts: ChatPanelShellParts;
  closeToolbarPanelOnOutsidePointer(event: PointerEvent): void;
}

export function createShellBundle(host: ChatPanelShellBundleHost, input: ChatPanelShellBundleInput): ChatPanelShellBundle {
  const {
    connection,
    connectionCoordinator,
    goals,
    rename,
    threadCommands,
    toolbarPanelActions,
    navigation,
    reconnect,
    history,
    pendingRequests,
    turn,
    composerController,
  } = input;
  const { environment, stateStore } = host;
  const toolbarActions = createToolbarUiActions({
    connectionCoordinator,
    reconnectCommand: reconnect,
    threadCommands,
    goals,
    toolbarPanel: toolbarPanelActions,
    rename,
    navigation,
    loadMoreThreads: () => environment.plugin.threadCatalog.loadMoreActiveThreads(),
    openSideChat: () => {
      const state = stateStore.getState();
      if (activePanelOperationDecision(state, "start-side-chat").kind !== "allowed") return;
      const threadId = activeThreadId(state);
      if (!threadId) return;
      const thread = environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId);
      void environment.plugin.workspace.openSideChat(threadId, thread?.name ?? thread?.preview ?? null);
    },
    debugDetails: {
      stateStore,
      connected: () => connection.isConnected(),
      vaultPath: () => environment.plugin.appServerContext.vaultPath,
      configuredCommand: () => environment.plugin.appServerContext.codexPath,
      runtimeConfig: () => environment.plugin.appServerQueries.runtimeConfigSnapshot(),
      rateLimit: () => environment.plugin.appServerQueries.rateLimitsSnapshot(),
      availableModels: () => environment.plugin.appServerQueries.modelsSnapshot() ?? [],
      metadataDiagnostics: () => environment.plugin.appServerQueries.metadataDiagnosticsSnapshot(),
    },
  });
  const toolbarDependencies: ChatPanelToolbarDependencies = {
    connection: {
      connected: () => connection.isConnected(),
    },
    settings: {
      vaultPath: () => environment.plugin.appServerContext.vaultPath,
      configuredCommand: () => environment.plugin.appServerContext.codexPath,
      archiveExportEnabled: () => environment.plugin.settings.archiveExportEnabled(),
    },
  };
  const goalDependencies: ChatPanelGoalDependencies = {
    sendShortcut: () => environment.plugin.settings.sendShortcut(),
    actions: goals,
  };
  const threadStreamContext = createChatThreadStreamDependencies({
    panelId: environment.obsidian.viewId,
    app: environment.obsidian.app,
    owner: environment.obsidian.owner,
    stateStore,
    vaultPath: environment.plugin.appServerContext.vaultPath,
    loadOlderTurns: () => void history.loadOlder(),
    actions: {
      rollbackThread: (threadId) => void threadCommands.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadCommands.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turn.submissionCommands.planImplementation.implement(itemId),
      openThreadInAvailableView: (threadId) => void environment.plugin.workspace.openThreadInAvailableView(threadId),
      openThreadInNewView: (threadId) => void environment.plugin.workspace.openThreadInNewView(threadId),
      openTurnDiff: (state) => void environment.plugin.workspace.openTurnDiff(state),
    },
    requests: pendingRequests,
  });
  const parts: ChatPanelShellParts = {
    toolbar: {
      dependencies: toolbarDependencies,
      actions: toolbarActions,
    },
    goal: goalDependencies,
    threadStream: {
      context: threadStreamContext,
      scrollPortBinding: host.threadStreamScrollBinding,
    },
    composer: {
      presenter: composerController,
      actions: {
        submit: () => void turn.submissionCommands.composerSubmit.submit(),
      },
    },
  };

  return {
    parts,
    closeToolbarPanelOnOutsidePointer: (event) => {
      toolbarPanelActions.closeOnOutsidePointer({
        hit: toolbarOutsidePointerHit(event, environment.view.panelRoot(), environment.view.viewWindow()),
        renameEditing: rename.isEditing(),
      });
    },
  };
}
