import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { CLIENT_VERSION } from "../../../../constants";
import type { Thread } from "../../../../domain/threads/model";
import { threadRowCoreProjection } from "../../../threads/list/row-projection";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { appServerDiagnosticSections } from "../../presentation/runtime/diagnostic-sections";
import { rateLimitSummary } from "../../presentation/runtime/status";
import { toolInventoryDiagnosticSections } from "../../presentation/runtime/tool-inventory-diagnostic-sections";
import { Toolbar, type ToolbarActions, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import type { ChatPanelToolbarReadModel } from "../shell-read-model";

export interface ChatPanelToolbarSurface {
  connection: {
    connected: () => boolean;
  };
  clock: {
    nowMs: () => number;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
}

interface ToolbarViewModelInput {
  model: ChatPanelToolbarReadModel;
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

function chatPanelToolbarViewModel(surface: ChatPanelToolbarSurface, model: ChatPanelToolbarReadModel) {
  return chatPanelToolbarProjection({
    model,
    snapshot: model.runtimeSnapshot.value,
    connected: surface.connection.connected(),
    nowMs: surface.clock.nowMs(),
    turnBusy: model.turnBusy.value,
    vaultPath: surface.settings.vaultPath(),
    configuredCommand: surface.settings.configuredCommand(),
    archiveExportEnabled: surface.settings.archiveExportEnabled(),
  });
}

export function ChatPanelToolbar({
  model,
  surface,
  actions,
}: {
  model: ChatPanelToolbarReadModel;
  surface: ChatPanelToolbarSurface;
  actions: ToolbarActions;
}): UiNode {
  return h(Toolbar, { model: chatPanelToolbarViewModel(surface, model), actions });
}

function chatPanelToolbarProjection(input: ToolbarViewModelInput): ToolbarViewModel {
  const { model, snapshot } = input;
  const projection = toolbarStateProjection(input);
  const limit = rateLimitSummary(snapshot, input.nowMs);
  const diagnostics = model.diagnostics.value;
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
    diagnostics: appServerDiagnosticSections({
      connected: input.connected,
      configuredCommand: input.configuredCommand,
      initializeResponse: diagnostics.initializeResponse,
      diagnostics: diagnostics.serverDiagnostics,
    }),
    toolInventory: toolInventoryDiagnosticSections(diagnostics.serverDiagnostics),
  };
}

function runtimeDebugDetails(input: ToolbarViewModelInput): string {
  const debug = input.model.debug.value;
  const connection = debug.connection;
  return JSON.stringify(
    {
      clientVersion: CLIENT_VERSION,
      vaultPath: input.vaultPath,
      configuredCommand: input.configuredCommand,
      activeThreadId: debug.activeThreadId,
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
      runtimeConfig: debug.runtimeConfig,
      runtime: debug.runtime,
      availableModels: debug.availableModels,
    },
    null,
    2,
  );
}

function toolbarStateProjection(input: {
  model: ChatPanelToolbarReadModel;
  turnBusy: boolean;
  archiveExportEnabled: boolean;
}): ToolbarStateProjection {
  const toolbarPanel = input.model.toolbarPanel.value;
  const historyOpen = toolbarPanel === "history";
  const chatActionsOpen = toolbarPanel === "chat-actions";
  const statusPanelOpen = toolbarPanel === "status-panel";
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: input.model.threads.value,
      activeThreadId: input.model.activeThreadId.value,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.model.archiveConfirmThreadId.value,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: input.model.rename.value,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: ChatPanelToolbarReadModel["rename"]["value"];
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

function toolbarActiveRenameState(renameState: ChatPanelToolbarReadModel["rename"]["value"], threadId: string) {
  if (renameState.kind === "idle" || renameState.threadId !== threadId) return undefined;
  return renameState;
}
