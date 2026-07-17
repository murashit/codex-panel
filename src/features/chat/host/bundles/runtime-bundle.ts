import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import { type ChatRuntimeSettingsActions, createChatRuntimeSettingsActions } from "../../application/runtime/settings-actions";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatStateStore } from "../../application/state/store";
import { collaborationModeIntentValue } from "../../domain/runtime/intent";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../../domain/runtime/labels";
import { type ChatPanelRuntimeProjection, createChatPanelRuntimeProjection } from "../../panel/runtime-status-projection";
import type { ChatPanelEnvironment } from "../contracts";

export type ChatPanelRuntimeSettingsActions = ChatRuntimeSettingsActions;

interface ChatPanelRuntimeStatus {
  addSystemMessage: (text: string) => void;
}

interface ChatPanelRuntimeHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
}

interface ChatPanelRuntimeBundle {
  settings: ChatPanelRuntimeSettingsActions;
  projection: ChatPanelRuntimeProjection;
}

export function createRuntimeBundle(
  host: ChatPanelRuntimeHost,
  input: {
    connection: ConnectionManager;
    appServer: ChatAppServerGateway;
    status: ChatPanelRuntimeStatus;
  },
): ChatPanelRuntimeBundle {
  return {
    settings: createChatRuntimeSettingsActions(
      {
        stateStore: host.stateStore,
        runtimeTransport: input.appServer.runtimeSettings,
        runtimeSnapshotForState: runtimeSnapshotForChatState,
        collaborationModeLabel: () => collaborationModeLabel(host.stateStore),
        addSystemMessage: (text) => {
          input.status.addSystemMessage(text);
        },
      },
      host.environment.plugin.runtimeSettingsCommitQueue,
    ),
    projection: createChatPanelRuntimeProjection({
      state: () => host.stateStore.getState(),
      connected: () => input.connection.isConnected(),
      configuredCommand: () => host.environment.plugin.settingsRef.settings.codexPath(),
      vaultPath: () => host.environment.plugin.settingsRef.vaultPath,
      nowMs: () => Date.now(),
    }),
  };
}

function collaborationModeLabel(stateStore: ChatStateStore): string {
  const runtime = stateStore.getState().runtime;
  return formatCollaborationModeLabel(collaborationModeIntentValue(runtime.pending.collaborationMode, runtime.active.collaborationMode));
}
