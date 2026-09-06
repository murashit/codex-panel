import { serverDiagnostics } from "../../../../domain/server/diagnostics";
import type { Thread } from "../../../../domain/threads/model";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import { appServerDiagnosticSections } from "../../ui/runtime/diagnostics";
import { runtimePermissionSections } from "../../ui/runtime/permissions";
import { rateLimitSummary } from "../../ui/runtime/status";
import { toolInventoryDiagnosticSections } from "../../ui/runtime/tool-inventory";
import type { ToolbarViewModel } from "../../ui/toolbar/model";
import { toolbarThreadRows } from "../../ui/toolbar/thread-rows";
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
    serverDiagnostics: serverDiagnostics(model.metadataDiagnostics, model.toolInventory?.mcpDiagnostics ?? []),
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
      archiveBlockedThreadId: model.turnBusy ? model.activeThreadId : null,
      selectedRowId,
      archiveConfirmThreadId: model.archiveConfirmThreadId,
      archiveExportEnabled,
      renameState: model.rename.kind === "idle" ? null : model.rename,
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
    toolInventory: toolInventoryDiagnosticSections(model.toolInventory, {
      value: model.availableSkills,
      probe: diagnostics.serverDiagnostics.probes.skills,
    }),
  };
}
