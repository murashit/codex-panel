import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { PendingRequestActions } from "../../application/pending-requests/pending-request-actions";
import type { ChatStateStore } from "../../application/state/store";
import type { HistoryController } from "../../application/threads/history-controller";
import type { ThreadRenameEditorActions } from "../../application/threads/rename-editor-actions";
import type { ChatComposerController } from "../../panel/composer-controller";
import type { ChatMessageStreamScrollBinding } from "../../panel/message-stream-scroll-binding";
import type { ChatPanelShellParts } from "../../panel/shell.dom";
import type { ChatPanelGoalSurface } from "../../panel/surface/goal-projection";
import { MessageStreamPresenter } from "../../panel/surface/message-stream-presenter";
import type { ChatPanelToolbarSurface } from "../../panel/surface/toolbar-projection";
import { createToolbarUiActions, type ToolbarPanelActions } from "../../panel/toolbar-actions";
import { toolbarOutsidePointerHit } from "../../panel/toolbar-hit-test.dom";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatPanelConnectionBundle } from "./connection-bundle";
import type { ChatPanelGoalActions, ChatPanelThreadActions, ChatPanelThreadNavigationActions } from "./thread-bundle";
import type { ChatPanelTurnBundle } from "./turn-bundle";

interface ChatPanelShellBundleHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  messageScrollBinding: ChatMessageStreamScrollBinding;
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
  dispose(): void;
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
  });
  const toolbarSurface: ChatPanelToolbarSurface = {
    connection: {
      connected: () => connection.isConnected(),
    },
    clock: {
      nowMs: () => Date.now(),
    },
    settings: {
      vaultPath: () => environment.plugin.settingsRef.vaultPath,
      configuredCommand: () => environment.plugin.settingsRef.settings.codexPath(),
      archiveExportEnabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled(),
    },
  };
  const goalSurface: ChatPanelGoalSurface = {
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut(),
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
      portBinding: host.messageScrollBinding,
      dispose: () => {
        host.messageScrollBinding.dispose();
      },
    },
    history: {
      loadOlderTurns: () => void history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (itemId) => void turn.turnActions.planImplementation.implement(itemId),
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
    messageStream: messageStreamPresenter,
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
    dispose: () => {
      messageStreamPresenter.dispose();
    },
  };
}
