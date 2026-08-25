import { compareThreadsPinnedFirst, type Thread } from "../../../../domain/threads/model";
import { threadRowCoreProjection } from "../../../threads/list/row-projection";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import type { ToolbarThreadRow, ToolbarViewModel } from "../../ui/toolbar-model";
import { appServerDiagnosticSections } from "../runtime/diagnostics";
import { runtimePermissionSections } from "../runtime/permissions";
import { rateLimitSummary } from "../runtime/status";
import { toolInventoryDiagnosticSections } from "../runtime/tool-inventory";
import type { ChatPanelToolbarModel } from "../shell/selectors";

export interface ChatPanelToolbarDependencies {
  connection: {
    connected: () => boolean;
  };
  visibleThreadId: (threads: readonly Thread[], threadId: string | null) => string | null;
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
}

export function projectChatPanelToolbar(
  model: ChatPanelToolbarModel,
  dependencies: ChatPanelToolbarDependencies,
  nowMs: number,
): ToolbarViewModel {
  const snapshot = runtimeSnapshotForChatSlices({
    runtimeConfig: model.runtimeConfig,
    activeThread: { id: model.activeThreadId, tokenUsage: model.activeThreadTokenUsage },
    runtime: model.runtime,
    rateLimit: model.rateLimit,
    hasThreadTurns: false,
    availableModels: model.availableModels,
  });
  const connected = dependencies.connection.connected();
  const vaultPath = dependencies.settings.vaultPath();
  const configuredCommand = dependencies.settings.configuredCommand();
  const archiveExportEnabled = dependencies.settings.archiveExportEnabled();
  const selectedRowId = dependencies.visibleThreadId(model.threads, model.activeThreadId);
  const limit = rateLimitSummary(snapshot, nowMs);
  const diagnostics = {
    initializeResponse: model.initializeResponse,
    serverDiagnostics: model.serverDiagnostics,
  };
  const permissions = runtimePermissionSections({
    snapshot,
    vaultPath,
  });
  const toolbarPanel = model.toolbarPanel;
  const openPanel = toolbarPanel === "status-panel" ? "status" : toolbarPanel;
  return {
    newChatDisabled: model.turnBusy && !model.activeThreadSubagent,
    sideChatStartDisabled: model.sideChatStartDisabled,
    compactDisabled: model.compactDisabled,
    goalMutationDisabled: model.goalMutationDisabled,
    rateLimit: limit,
    openPanel,
    threads: toolbarThreadRows({
      threads: model.threads,
      activeThreadId: model.activeThreadId,
      selectedRowId,
      turnBusy: model.turnBusy,
      archiveConfirmThreadId: model.archiveConfirmThreadId,
      archiveExportEnabled,
      renameState: model.rename,
    }),
    hasMoreThreads: model.hasMoreThreads,
    threadListLoading: model.threadListLoading,
    threadListFetching: model.threadListFetching,
    loadingMoreThreads: model.isFetchingNextPage,
    threadListError: model.threadListError,
    connectLabel: connected ? "Reconnect" : "Connect",
    permissionsAndApprovals: permissions,
    diagnostics: appServerDiagnosticSections({
      connected,
      configuredCommand,
      initializeResponse: diagnostics.initializeResponse,
      diagnostics: diagnostics.serverDiagnostics,
    }),
    toolInventory: toolInventoryDiagnosticSections(diagnostics.serverDiagnostics, {
      value: model.availableSkills,
      probe: diagnostics.serverDiagnostics.probes.skills,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  selectedRowId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: ChatPanelToolbarModel["rename"];
}): ToolbarThreadRow[] {
  return [...input.threads].sort(compareThreadsPinnedFirst).map((thread) => {
    const threadId = thread.id;
    const core = threadRowCoreProjection({
      thread,
      selected: threadId === input.selectedRowId,
      renameState: toolbarActiveRenameState(input.renameState, threadId),
      archiveConfirmActive: input.archiveConfirmThreadId === threadId,
      defaultArchiveSaveMarkdown: input.archiveExportEnabled,
    });
    return {
      title: core.title,
      threadId: core.threadId,
      selected: core.selected,
      isPinned: core.isPinned,
      renameDisabled: input.renameState.kind === "saving",
      archiveDisabled: threadId === input.activeThreadId && input.turnBusy,
      archiveConfirm: core.archiveConfirm,
      rename: core.rename.active
        ? {
            draft: core.rename.draft,
            generating: core.rename.generating,
            saving: core.rename.saving,
            autoNameDisabled: core.rename.autoNameDisabled,
          }
        : null,
    };
  });
}

function toolbarActiveRenameState(renameState: ChatPanelToolbarModel["rename"], threadId: string) {
  if (renameState.kind === "idle" || renameState.threadId !== threadId) return undefined;
  return renameState;
}
