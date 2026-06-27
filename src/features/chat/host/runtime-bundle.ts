import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { connectionDiagnosticSectionsFromState } from "../application/connection/diagnostic-sections";
import { toolInventoryDiagnosticSections } from "../application/connection/tool-inventory-diagnostic-sections";
import { type ChatRuntimeSettingsActions, createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatStateStore } from "../application/state/store";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../domain/runtime/labels";
import type { RuntimeSnapshot } from "../domain/runtime/snapshot";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
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

export interface ChatPanelRuntimeProjection {
  connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  toolInventoryDetails: () => MessageStreamNoticeSection[];
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
    currentClient,
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
  return {
    connectionDiagnosticDetails: () => connectionDiagnosticDetails(host, connection),
    modelStatusLines: () => modelStatusLines(host),
    effortStatusLines: () => effortStatusLines(host),
    statusSummaryLines: () => statusSummaryLines(host),
    toolInventoryDetails: () => toolInventoryDetails(host),
  };
}

function statusSummaryLines(host: ChatPanelRuntimeHost): string[] {
  const state = host.stateStore.getState();
  return buildStatusSummaryLines({
    activeThreadId: state.activeThread.id,
    snapshot: runtimeSnapshot(host),
    nowMs: Date.now(),
  });
}

function modelStatusLines(host: ChatPanelRuntimeHost): string[] {
  const state = host.stateStore.getState();
  return buildModelStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    pendingModel: state.runtime.pending.model,
    snapshot: runtimeSnapshot(host),
    collaborationModeLabel: collaborationModeLabel(host.stateStore),
  });
}

function effortStatusLines(host: ChatPanelRuntimeHost): string[] {
  const state = host.stateStore.getState();
  return buildEffortStatusLines({
    runtimeConfig: state.connection.runtimeConfig,
    pendingReasoningEffort: state.runtime.pending.reasoningEffort,
    snapshot: runtimeSnapshot(host),
  });
}

function connectionDiagnosticDetails(host: ChatPanelRuntimeHost, connection: ConnectionManager): MessageStreamNoticeSection[] {
  const sections = connectionDiagnosticSectionsFromState({
    state: host.stateStore.getState(),
    connected: connection.isConnected(),
    configuredCommand: host.environment.plugin.settingsRef.settings.codexPath,
  });
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function toolInventoryDetails(host: ChatPanelRuntimeHost): MessageStreamNoticeSection[] {
  const sections = toolInventoryDiagnosticSections(host.stateStore.getState().connection.serverDiagnostics);
  return sections.map((section) => ({
    title: section.title,
    auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
  }));
}

function runtimeSnapshot(host: ChatPanelRuntimeHost): RuntimeSnapshot {
  return runtimeSnapshotForChatState(host.stateStore.getState());
}
