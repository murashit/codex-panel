import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { CLIENT_VERSION } from "../../../../constants";
import type { Thread } from "../../../../domain/threads/model";
import { threadRowCoreProjection } from "../../../threads/list/row-projection";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import { activeThreadState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { appServerDiagnosticSections } from "../../presentation/runtime/diagnostic-sections";
import { runtimePermissionSections } from "../../presentation/runtime/permission-sections";
import { rateLimitSummary } from "../../presentation/runtime/status";
import { toolInventoryDiagnosticSections } from "../../presentation/runtime/tool-inventory-diagnostic-sections";
import { Toolbar, type ToolbarActions, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import type { ChatPanelToolbarModel } from "../shell-selectors";

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
  model: ChatPanelToolbarModel;
  stateStore: ChatStateStore;
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
  sideChatStartDisabled: boolean;
  compactDisabled: boolean;
  goalMutationDisabled: boolean;
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  openPanel: ToolbarViewModel["openPanel"];
  threads: ToolbarThreadRow[];
}

function chatPanelToolbarViewModel(surface: ChatPanelToolbarSurface, model: ChatPanelToolbarModel, stateStore: ChatStateStore) {
  return chatPanelToolbarProjection({
    model,
    stateStore,
    snapshot: runtimeSnapshotForChatSlices({
      runtimeConfig: model.connection.runtimeConfig,
      activeThread: { id: model.activeThreadId, tokenUsage: model.activeThreadTokenUsage },
      runtime: model.runtime,
      rateLimit: model.connection.rateLimit,
      hasThreadTurns: false,
      availableModels: model.connection.availableModels,
    }),
    connected: surface.connection.connected(),
    nowMs: surface.clock.nowMs(),
    turnBusy: model.turnBusy,
    vaultPath: surface.settings.vaultPath(),
    configuredCommand: surface.settings.configuredCommand(),
    archiveExportEnabled: surface.settings.archiveExportEnabled(),
  });
}

export function ChatPanelToolbar({
  model,
  stateStore,
  surface,
  actions,
}: {
  model: ChatPanelToolbarModel;
  stateStore: ChatStateStore;
  surface: ChatPanelToolbarSurface;
  actions: ToolbarActions;
}): UiNode {
  return h(Toolbar, { model: chatPanelToolbarViewModel(surface, model, stateStore), actions });
}

function chatPanelToolbarProjection(input: ToolbarViewModelInput): ToolbarViewModel {
  const { model, snapshot } = input;
  const projection = toolbarStateProjection(input);
  const limit = rateLimitSummary(snapshot, input.nowMs);
  const diagnostics = model.connection;
  const permissions = runtimePermissionSections({
    snapshot,
    vaultPath: input.vaultPath,
  });
  return {
    newChatDisabled: projection.newChatDisabled,
    sideChatStartDisabled: projection.sideChatStartDisabled,
    compactDisabled: projection.compactDisabled,
    goalMutationDisabled: projection.goalMutationDisabled,
    chatActionsOpen: projection.chatActionsOpen,
    historyOpen: projection.historyOpen,
    statusPanelOpen: projection.statusPanelOpen,
    rateLimit: limit,
    debugDetails: () => runtimeDebugDetails(input),
    openPanel: projection.openPanel,
    threads: projection.threads,
    hasMoreThreads: model.hasMoreThreads,
    threadListLoading: model.threadListLoading,
    threadListFetching: model.threadListFetching,
    loadingMoreThreads: model.isFetchingNextPage,
    threadListError: model.threadListError,
    connectLabel: input.connected ? "Reconnect" : "Connect",
    permissionsAndApprovals: permissions,
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
  const state = input.stateStore.getState();
  const activeThread = activeThreadState(state);
  const connection = state.connection;
  return JSON.stringify(
    {
      clientVersion: CLIENT_VERSION,
      vaultPath: input.vaultPath,
      configuredCommand: input.configuredCommand,
      activeThreadId: activeThread?.id ?? null,
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
      runtime: state.runtime,
      availableModels: connection.availableModels,
    },
    null,
    2,
  );
}

function toolbarStateProjection(input: {
  model: ChatPanelToolbarModel;
  turnBusy: boolean;
  archiveExportEnabled: boolean;
}): ToolbarStateProjection {
  const toolbarPanel = input.model.toolbarPanel;
  const historyOpen = toolbarPanel === "history";
  const chatActionsOpen = toolbarPanel === "chat-actions";
  const statusPanelOpen = toolbarPanel === "status-panel";
  return {
    newChatDisabled: input.turnBusy && !input.model.activeThreadSubagent,
    sideChatStartDisabled: input.model.sideChatStartDisabled,
    compactDisabled: input.model.compactDisabled,
    goalMutationDisabled: input.model.goalMutationDisabled,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: input.model.threads,
      activeThreadId: input.model.activeThreadId,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.model.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: input.model.rename,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: ChatPanelToolbarModel["rename"];
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
      openDisabled: false,
      canArchive: true,
      archiveConfirm: core.archiveConfirm,
      rename: core.rename.active ? { draft: core.rename.draft, generating: core.rename.generating } : null,
    };
  });
}

function toolbarActiveRenameState(renameState: ChatPanelToolbarModel["rename"], threadId: string) {
  if (renameState.kind === "idle" || renameState.threadId !== threadId) return undefined;
  return renameState;
}
