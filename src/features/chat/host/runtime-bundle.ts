import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { createChatRuntimeSettingsTransport } from "../app-server/runtime/thread-settings-transport";
import { type ChatRuntimeSettingsActions, createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatStateStore } from "../application/state/store";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../domain/runtime/labels";
import { type ChatPanelRuntimeProjection, createChatPanelRuntimeProjection } from "../panel/runtime-status-projection";
import type { CurrentAppServerClient } from "./connection-bundle";
import type { ChatPanelEnvironment } from "./contracts";

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
    currentClient: CurrentAppServerClient;
    status: ChatPanelRuntimeStatus;
  },
): ChatPanelRuntimeBundle {
  return {
    settings: createSessionRuntimeSettingsActions(host, input.currentClient, input.status),
    projection: createSessionRuntimeProjection(host, input.connection),
  };
}

function createSessionRuntimeSettingsActions(
  host: ChatPanelRuntimeHost,
  currentClient: CurrentAppServerClient,
  status: ChatPanelRuntimeStatus,
): ChatPanelRuntimeSettingsActions {
  return createChatRuntimeSettingsActions({
    stateStore: host.stateStore,
    runtimeTransport: createChatRuntimeSettingsTransport({
      currentClient,
    }),
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    collaborationModeLabel: () => collaborationModeLabel(host.stateStore),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  });
}

function collaborationModeLabel(stateStore: ChatStateStore): string {
  return formatCollaborationModeLabel(stateStore.getState().runtime.pending.collaborationMode);
}

function createSessionRuntimeProjection(host: ChatPanelRuntimeHost, connection: ConnectionManager): ChatPanelRuntimeProjection {
  return createChatPanelRuntimeProjection({
    state: () => host.stateStore.getState(),
    connected: () => connection.isConnected(),
    configuredCommand: () => host.environment.plugin.settingsRef.settings.codexPath(),
    nowMs: () => Date.now(),
  });
}
