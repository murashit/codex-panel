import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { CLIENT_VERSION } from "../../../../constants";
import type { Thread } from "../../../../domain/threads/model";
import { threadRowCoreProjection } from "../../../threads/row-projection";
import { connectionDiagnosticSectionsModel } from "../../application/connection/diagnostics-display";
import { toolInventoryDiagnosticSections } from "../../application/connection/tool-inventory-display";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { rateLimitSummary } from "../../presentation/runtime/status";
import { Toolbar, type ToolbarActions, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import { type ChatPanelToolbarShellState, toolbarStateFromShellState, useChatPanelShellState } from "../shell-state";

export interface ChatPanelToolbarSurface {
  state: {
    connected: () => boolean;
    nowMs: () => number;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
}

interface ToolbarViewModelInput {
  state: ChatPanelToolbarShellState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  nowMs: number;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveExportEnabled: boolean;
}

interface ToolbarStateProjection {
  newChatDisabled: boolean;
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  openPanel: ToolbarViewModel["openPanel"];
  threads: ToolbarThreadRow[];
}

function chatPanelToolbarViewModel(surface: ChatPanelToolbarSurface, state: ChatPanelToolbarShellState) {
  return chatPanelToolbarProjection({
    state,
    snapshot: state.runtimeSnapshot,
    connected: surface.state.connected(),
    nowMs: surface.state.nowMs(),
    turnBusy: state.turnBusy,
    vaultPath: surface.settings.vaultPath(),
    configuredCommand: surface.settings.configuredCommand(),
    archiveExportEnabled: surface.settings.archiveExportEnabled(),
  });
}

export function ChatPanelToolbar({ surface, actions }: { surface: ChatPanelToolbarSurface; actions: ToolbarActions }): UiNode {
  const state = toolbarStateFromShellState(useChatPanelShellState());
  return h(Toolbar, { model: chatPanelToolbarViewModel(surface, state), actions });
}

function chatPanelToolbarProjection(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const projection = toolbarStateProjection(input);
  const limit = rateLimitSummary(snapshot, input.nowMs);
  return {
    newChatDisabled: projection.newChatDisabled,
    chatActionsOpen: projection.chatActionsOpen,
    historyOpen: projection.historyOpen,
    statusPanelOpen: projection.statusPanelOpen,
    rateLimit: limit,
    debugDetails: () => runtimeDebugDetails(input),
    openPanel: projection.openPanel,
    threads: projection.threads,
    connectLabel: input.connected ? "Reconnect" : "Connect",
    diagnostics: connectionDiagnosticSectionsModel({
      state,
      connected: input.connected,
      configuredCommand: input.configuredCommand,
    }),
    toolInventory: toolInventoryDiagnosticSections(state.connection.serverDiagnostics),
  };
}

function runtimeDebugDetails(input: ToolbarViewModelInput): string {
  const connection = input.state.connection;
  return JSON.stringify(
    {
      clientVersion: CLIENT_VERSION,
      vaultPath: input.vaultPath,
      configuredCommand: input.configuredCommand,
      activeThreadId: input.state.activeThreadId,
      connection: {
        connected: input.connected,
        phase: connection.phase,
        statusText: connection.statusText,
        initializeResponse: connection.initializeResponse,
        rateLimit: connection.rateLimit,
        serverDiagnostics: {
          probes: connection.serverDiagnostics.probes,
          mcpServers: connection.serverDiagnostics.mcpServers,
        },
      },
      runtimeConfig: connection.runtimeConfig,
      runtime: input.state.runtime,
      availableModels: connection.availableModels,
    },
    null,
    2,
  );
}

function toolbarStateProjection(input: {
  state: ChatPanelToolbarShellState;
  turnBusy: boolean;
  archiveExportEnabled: boolean;
}): ToolbarStateProjection {
  const historyOpen = input.state.ui.toolbarPanel === "history";
  const chatActionsOpen = input.state.ui.toolbarPanel === "chat-actions";
  const statusPanelOpen = input.state.ui.toolbarPanel === "status-panel";
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: input.state.threadList.listedThreads,
      activeThreadId: input.state.activeThreadId,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.state.ui.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: input.state.ui.rename,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: ChatPanelToolbarShellState["ui"]["rename"];
}): ToolbarThreadRow[] {
  return input.threads.map((thread) => {
    const threadId = thread.id;
    const core = threadRowCoreProjection({
      thread,
      selected: threadId === input.activeThreadId,
      renameState: toolbarActiveRenameState(input.renameState, threadId),
      archiveConfirmActive: input.archiveConfirmThreadId === threadId,
      defaultArchiveSaveMarkdown: input.archiveExportEnabled,
    });
    return {
      title: core.title,
      threadId: core.threadId,
      selected: core.selected,
      disabled: input.turnBusy && threadId !== input.activeThreadId,
      canArchive: true,
      archiveConfirm: core.archiveConfirm,
      rename: core.rename.active ? { draft: core.rename.draft, generating: core.rename.generating } : null,
    };
  });
}

function toolbarActiveRenameState(renameState: ChatPanelToolbarShellState["ui"]["rename"], threadId: string) {
  if (renameState.kind === "idle" || renameState.threadId !== threadId) return undefined;
  return renameState;
}
