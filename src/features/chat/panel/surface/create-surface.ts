import type { CodexPanelSettings } from "../../../../settings/model";
import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { ChatStateStore } from "../../application/state/store";
import type { ChatConnectionController } from "../../application/connection/connection-controller";
import type { ChatInboundController } from "../../app-server/inbound/controller";
import type { ChatRuntimeSettingsActions } from "../../application/runtime/settings-actions";
import type { GoalActions } from "../../application/threads/goal-actions";
import type { RestoredThreadTitleSnapshot, ChatPanelSurface } from "./model";
import { createChatPanelGoalSurface } from "./goal-surface";

export interface ChatPanelSurfaceHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  stateStore: ChatStateStore;
  restoredThreadPlaceholder: () => RestoredThreadTitleSnapshot | null;
}

export interface ChatPanelSurfaceDependencies {
  connection: ConnectionManager;
  connectionController: ChatConnectionController;
  inboundController: ChatInboundController;
  threadStarter: ChatPanelThreadStarter;
  runtimeSettings: ChatRuntimeSettingsActions;
  goals: GoalActions;
}

interface ChatPanelThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
}

export function createChatPanelSurface(host: ChatPanelSurfaceHost, deps: ChatPanelSurfaceDependencies): ChatPanelSurface {
  return {
    toolbar: {
      state: {
        connected: () => deps.connection.isConnected(),
        nowMs: () => Date.now(),
      },
      settings: {
        vaultPath: () => host.vaultPath,
        configuredCommand: () => host.settings.codexPath,
        archiveExportEnabled: () => host.settings.archiveExportEnabled,
      },
    },
    goal: createChatPanelGoalSurface(
      {
        settings: host.settings,
        stateStore: host.stateStore,
      },
      {
        connectionController: deps.connectionController,
        inboundController: deps.inboundController,
        threadStarter: deps.threadStarter,
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
