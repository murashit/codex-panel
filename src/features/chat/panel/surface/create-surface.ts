import type { CodexPanelSettings } from "../../../../settings/model";
import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { ChatStateStore } from "../../state/reducer";
import type { ChatConnectionController } from "../../connection/connection-controller";
import type { ChatReconnectActions } from "../../connection/reconnect-actions";
import type { ChatInboundController } from "../../protocol/inbound/controller";
import type { ChatServerThreadActions } from "../../connection/server-actions/threads";
import type { ChatThreadActions } from "../../threads/action-context";
import type { ToolbarPanelActions } from "../toolbar-actions";
import type { RenameController } from "../../threads/rename-controller";
import type { SelectionActions } from "../../threads/selection-actions";
import type { ChatRuntimeSettingsActions } from "../../runtime/settings-actions";
import type { GoalActions } from "../../threads/goal-actions";
import type { RestoredThreadTitleSnapshot, ChatPanelSurface } from "./model";
import { createChatPanelGoalSurface } from "./goal-surface";
import { createChatPanelToolbarSurface } from "./toolbar-surface";

export interface ChatPanelSurfaceHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  stateStore: ChatStateStore;
  restoredThreadPlaceholder: () => RestoredThreadTitleSnapshot | null;
  startNewThread: () => Promise<void>;
}

export interface ChatPanelSurfaceDependencies {
  connection: ConnectionManager;
  connectionController: ChatConnectionController;
  reconnectActions: ChatReconnectActions;
  inboundController: ChatInboundController;
  serverThreads: ChatServerThreadActions;
  threadActions: ChatThreadActions;
  toolbarPanels: ToolbarPanelActions;
  rename: RenameController;
  selection: SelectionActions;
  runtimeSettings: ChatRuntimeSettingsActions;
  goals: GoalActions;
}

export function createChatPanelSurface(host: ChatPanelSurfaceHost, deps: ChatPanelSurfaceDependencies): ChatPanelSurface {
  return {
    toolbar: createChatPanelToolbarSurface(
      {
        settings: host.settings,
        vaultPath: host.vaultPath,
        stateStore: host.stateStore,
        startNewThread: host.startNewThread,
      },
      {
        connection: deps.connection,
        connectionController: deps.connectionController,
        reconnectActions: deps.reconnectActions,
        inboundController: deps.inboundController,
        threadActions: deps.threadActions,
        toolbarPanels: deps.toolbarPanels,
        rename: deps.rename,
        selection: deps.selection,
      },
    ),
    goal: createChatPanelGoalSurface(
      {
        settings: host.settings,
        stateStore: host.stateStore,
      },
      {
        connectionController: deps.connectionController,
        inboundController: deps.inboundController,
        serverThreads: deps.serverThreads,
        goals: deps.goals,
      },
    ),
    composer: {
      thread: {
        restoredPlaceholder: host.restoredThreadPlaceholder,
      },
      runtime: {
        requestModel: (model) => deps.runtimeSettings.requestModelFromUi(model),
        requestReasoningEffort: (effort) => deps.runtimeSettings.requestReasoningEffortFromUi(effort),
        resetReasoningEffortToConfig: () => deps.runtimeSettings.resetReasoningEffortToConfigFromUi(),
      },
    },
  };
}
