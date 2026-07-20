import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import type { PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import { activeThreadId } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { HistoryController } from "../../application/threads/history-controller";
import type { ThreadRenameEditorActions } from "../../application/threads/rename-editor-actions";
import type { ChatComposerController } from "../../panel/composer-controller";
import type { ChatPanelShellParts } from "../../panel/shell.dom";
import type { ChatPanelGoalSurface } from "../../panel/surface/goal-projection";
import { createChatThreadStreamSurfaceContext } from "../../panel/surface/thread-stream-surface.obsidian";
import type { ChatPanelToolbarSurface } from "../../panel/surface/toolbar-projection";
import type { ChatThreadStreamScrollBinding } from "../../panel/thread-stream-scroll-binding";
import { createToolbarUiActions, type ToolbarPanelActions } from "../../panel/toolbar-actions";
import { toolbarOutsidePointerHit } from "../../panel/toolbar-hit-test.dom";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatPanelConnectionBundle } from "./connection-bundle";
import type { ChatPanelGoalActions, ChatPanelThreadActions, ChatPanelThreadNavigationActions } from "./thread-bundle";
import type { ChatPanelTurnBundle } from "./turn-bundle";

interface ChatPanelShellBundleHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: ChatThreadStreamScrollBinding;
}

interface ChatPanelShellBundleInput {
  connection: ConnectionManager;
  connectionActions: ChatPanelConnectionBundle["connection"]["actions"];
  goals: ChatPanelGoalActions;
  rename: ThreadRenameEditorActions;
  threadActions: ChatPanelThreadActions;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationActions;
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
    connectionActions,
    goals,
    rename,
    threadActions,
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
    connectionActions,
    reconnectPanel: reconnect,
    threadActions,
    goals,
    toolbarPanel: toolbarPanelActions,
    rename,
    navigation,
    loadMoreThreads: () => environment.plugin.threadCatalog.loadMoreActive(),
    openSideChat: () => {
      const state = stateStore.getState();
      if (activePanelOperationDecision(state, "start-side-chat").kind !== "allowed") return;
      const threadId = activeThreadId(state);
      if (!threadId) return;
      const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
      void environment.plugin.workspace.openSideChat(threadId, thread?.name ?? thread?.preview ?? null);
    },
    canStartSideChat: () => activePanelOperationDecision(stateStore.getState(), "start-side-chat").kind === "allowed",
    canCompact: () => activePanelOperationDecision(stateStore.getState(), "compact").kind === "allowed",
    canMutateGoal: () => activePanelOperationDecision(stateStore.getState(), "goal-mutation").kind !== "blocked",
  });
  const toolbarSurface: ChatPanelToolbarSurface = {
    connection: {
      connected: () => connection.isConnected(),
    },
    clock: {
      nowMs: () => Date.now(),
    },
    settings: {
      vaultPath: () => environment.plugin.appServerContext.vaultPath,
      configuredCommand: () => environment.plugin.appServerContext.codexPath,
      archiveExportEnabled: () => environment.plugin.settings.archiveExportEnabled(),
    },
  };
  const goalSurface: ChatPanelGoalSurface = {
    sendShortcut: () => environment.plugin.settings.sendShortcut(),
    actions: goals,
  };
  const threadStreamContext = createChatThreadStreamSurfaceContext({
    panelId: environment.obsidian.viewId,
    app: environment.obsidian.app,
    owner: environment.obsidian.owner,
    stateStore,
    vaultPath: environment.plugin.appServerContext.vaultPath,
    loadOlderTurns: () => void history.loadOlder(),
    actions: {
      rollbackThread: (threadId) => void threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turn.turnActions.planImplementation.implement(itemId),
      openThreadInNewView: (threadId) => void environment.plugin.workspace.openThreadInNewView(threadId),
      openTurnDiff: (state) => void environment.plugin.workspace.openTurnDiff(state),
    },
    requests: {
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });
  const parts: ChatPanelShellParts = {
    toolbar: {
      surface: toolbarSurface,
      actions: toolbarActions,
    },
    goal: goalSurface,
    threadStream: {
      context: threadStreamContext,
      scrollPortBinding: host.threadStreamScrollBinding,
    },
    composer: {
      presenter: composerController,
      actions: {
        submit: () => void turn.turnActions.composerSubmit.submit(),
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
