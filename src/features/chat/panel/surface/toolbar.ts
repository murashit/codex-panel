import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import { runtimeConfigSections, rateLimitSummary } from "../../display/status/runtime";
import { connectionDiagnosticSections } from "../../display/status/diagnostics";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../runtime/snapshot";
import { chatTurnBusy, type ChatState } from "../../state/reducer";
import { messageStreamDisplayItems } from "../../state/message-stream";
import { toolbarStateFromShellState, useChatPanelShellState, type ChatPanelToolbarShellState } from "../../ui/shell-state";
import { Toolbar, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import type { ChatPanelToolbarPorts } from "./ports";

type ToolbarState = Pick<ChatState, "connection" | "threadList" | "activeThread" | "ui">;

export interface ToolbarViewModelInput {
  state: ToolbarState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameRevision: number;
  renameState: (threadId: string, renameRevision: number) => ToolbarThreadRow["rename"];
}

export interface ConnectionDiagnosticsModelInput {
  state: Pick<ChatState, "connection">;
  connected: boolean;
  configuredCommand: string;
}

function chatPanelToolbarViewModel(ports: ChatPanelToolbarPorts, state: ChatPanelToolbarShellState) {
  return toolbarViewModel({
    state,
    snapshot: runtimeSnapshotForChatSlices({
      runtimeConfig: state.connection.runtimeConfig,
      activeThread: state.activeThread,
      runtime: state.runtime,
      rateLimit: state.connection.rateLimit,
      displayItems: messageStreamDisplayItems(state.messageStream),
      availableModels: state.connection.availableModels,
    }),
    connected: ports.state.connected(),
    turnBusy: chatTurnBusy(state),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.view.toolbar.archiveConfirm.value,
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameRevision: ports.view.toolbar.renameVersion.value,
    renameState: (threadId, _renameRevision) => ports.view.toolbar.renameState(threadId),
  });
}

export function ChatPanelToolbar({ ports }: { ports: ChatPanelToolbarPorts }): UiNode {
  const state = toolbarStateFromShellState(useChatPanelShellState());
  return h(Toolbar, { model: chatPanelToolbarViewModel(ports, state), actions: ports.actions.toolbar });
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const limit = rateLimitSummary(snapshot, Date.now());
  const historyOpen = state.ui.toolbarPanel === "history";
  const chatActionsOpen = state.ui.toolbarPanel === "chat-actions";
  const statusPanelOpen = state.ui.toolbarPanel === "status-panel";
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    rateLimit: limit,
    configSections: runtimeConfigSections(snapshot, input.vaultPath),
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: state.threadList.listedThreads,
      activeThreadId: state.activeThread.id,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameRevision: input.renameRevision,
      renameState: input.renameState,
    }),
    connectLabel: input.connected ? "Reconnect" : "Connect",
    diagnostics: connectionDiagnosticsModel({
      state,
      connected: input.connected,
      configuredCommand: input.configuredCommand,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameRevision: number;
  renameState: (threadId: string, renameRevision: number) => ToolbarThreadRow["rename"];
}): ToolbarThreadRow[] {
  const renameRevision = input.renameRevision;
  return input.threads.map((thread) => {
    const threadId = thread.id;
    return {
      title: getThreadTitle(thread),
      threadId,
      selected: threadId === input.activeThreadId,
      disabled: input.turnBusy && threadId !== input.activeThreadId,
      canArchive: true,
      archiveConfirm: {
        active: input.archiveConfirmThreadId === threadId,
        defaultSaveMarkdown: input.archiveExportEnabled,
      },
      rename: input.renameState(threadId, renameRevision),
    };
  });
}

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    diagnostics: input.state.connection.serverDiagnostics,
  });
}
