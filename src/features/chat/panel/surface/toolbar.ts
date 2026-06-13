import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import { runtimeConfigSections, rateLimitSummary } from "../../display/status/runtime";
import { connectionDiagnosticSections } from "../../display/status/diagnostics";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import { chatTurnBusy, type ChatState } from "../../state/reducer";
import { toolbarStateFromShellState, useChatPanelShellState, type ChatPanelToolbarShellState } from "../../ui/shell-state";
import { Toolbar, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import type { ChatPanelToolbarSurface } from "./model";
import { runtimeSnapshotForToolbarShellState } from "./runtime-snapshot";

type ToolbarState = Pick<ChatState, "connection" | "threadList" | "activeThread" | "ui">;

export interface ToolbarViewModelInput {
  state: ToolbarState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  nowMs: number;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveExportEnabled: boolean;
}

export interface ConnectionDiagnosticsModelInput {
  state: Pick<ChatState, "connection">;
  connected: boolean;
  configuredCommand: string;
}

function chatPanelToolbarViewModel(surface: ChatPanelToolbarSurface, state: ChatPanelToolbarShellState) {
  return toolbarViewModel({
    state,
    snapshot: runtimeSnapshotForToolbarShellState(state),
    connected: surface.state.connected(),
    nowMs: surface.state.nowMs(),
    turnBusy: chatTurnBusy(state),
    vaultPath: surface.settings.vaultPath(),
    configuredCommand: surface.settings.configuredCommand(),
    archiveExportEnabled: surface.settings.archiveExportEnabled(),
  });
}

export function ChatPanelToolbar({ surface }: { surface: ChatPanelToolbarSurface }): UiNode {
  const state = toolbarStateFromShellState(useChatPanelShellState());
  return h(Toolbar, { model: chatPanelToolbarViewModel(surface, state), actions: surface.actions.toolbar });
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const limit = rateLimitSummary(snapshot, input.nowMs);
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
      archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: state.ui.rename,
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
  renameState: ChatState["ui"]["rename"];
}): ToolbarThreadRow[] {
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
      rename: toolbarRenameState(input.renameState, threadId),
    };
  });
}

function toolbarRenameState(renameState: ChatState["ui"]["rename"], threadId: string): ToolbarThreadRow["rename"] {
  if (renameState.kind === "idle" || renameState.threadId !== threadId) return null;
  return {
    draft: renameState.draft,
    generating: renameState.kind === "generating",
  };
}

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    diagnostics: input.state.connection.serverDiagnostics,
  });
}
