import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import type { MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import { serverDiagnostics } from "../../../../domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { Thread } from "../../../../domain/threads/model";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import { activeThreadState, type ChatState, panelThreadProvenance } from "../../application/state/model";
import { chatTurnBusy } from "../../application/turns/turn-state";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { appServerDiagnosticSections } from "../../ui/runtime/diagnostics";
import { runtimePermissionSections } from "../../ui/runtime/permissions";
import { rateLimitSummary } from "../../ui/runtime/status";
import { toolInventoryDiagnosticSections } from "../../ui/runtime/tool-inventory";
import type { ToolbarViewModel } from "../../ui/toolbar/model";
import { toolbarThreadRows } from "../../ui/toolbar/thread-rows";

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
  const connected = dependencies.connection.connected();
  const vaultPath = dependencies.settings.vaultPath();
  const configuredCommand = dependencies.settings.configuredCommand();
  const archiveExportEnabled = dependencies.settings.archiveExportEnabled();
  const selectedRowId = dependencies.visibleThreadId(model.threads, model.activeThreadId);
  const limit = rateLimitSummary(model, nowMs);
  const diagnostics = {
    initializeResponse: model.initializeResponse,
    serverDiagnostics: serverDiagnostics(model.metadataDiagnostics, model.toolInventory?.mcpDiagnostics ?? []),
  };
  const permissions = runtimePermissionSections({
    snapshot: model,
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

export interface ChatPanelToolbarSharedValues {
  readonly activeThreads: {
    readonly threads: readonly Thread[];
    readonly hasMore: boolean;
    readonly isFetching: boolean;
    readonly isFetchingNextPage: boolean;
    readonly error: string | null;
  };
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly models: readonly ModelMetadata[];
  readonly skills: readonly SkillMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
  readonly metadataDiagnostics: MetadataResourceDiagnostics;
  readonly toolInventory: ToolInventorySnapshot | null;
}

export interface ChatPanelToolbarModel extends RuntimeSnapshot {
  readonly threads: readonly Thread[];
  readonly hasMoreThreads: boolean;
  readonly threadListLoading: boolean;
  readonly threadListFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly threadListError: string | null;
  readonly activeThreadSubagent: boolean;
  readonly sideChatStartDisabled: boolean;
  readonly compactDisabled: boolean;
  readonly goalMutationDisabled: boolean;
  readonly turnBusy: boolean;
  readonly availableSkills: readonly SkillMetadata[];
  readonly initializeResponse: ChatState["connection"]["initializeResponse"];
  readonly metadataDiagnostics: MetadataResourceDiagnostics;
  readonly toolInventory: ToolInventorySnapshot | null;
  readonly toolbarPanel: ChatState["ui"]["toolbarPanel"];
  readonly archiveConfirmThreadId: ChatState["ui"]["archiveConfirmThreadId"];
  readonly rename: ChatState["ui"]["rename"];
}

export function selectChatPanelToolbar(state: ChatState, shared: ChatPanelToolbarSharedValues): ChatPanelToolbarModel {
  const activeThread = activeThreadState(state);
  const threads = shared.activeThreads;
  return {
    ...runtimeSnapshotForChatSlices({
      runtimeConfig: shared.runtimeConfig,
      activeThread: { id: activeThread?.id ?? null, tokenUsage: activeThread?.tokenUsage ?? null },
      runtime: state.runtime,
      rateLimit: shared.rateLimit,
      hasThreadTurns: false,
      availableModels: shared.models,
    }),
    threads: threads.threads,
    hasMoreThreads: threads.hasMore,
    threadListLoading: threads.isFetching && threads.threads.length === 0,
    threadListFetching: threads.isFetching,
    isFetchingNextPage: threads.isFetchingNextPage,
    threadListError: threads.error,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    sideChatStartDisabled: !activeThread || activePanelOperationDecision(state, "start-side-chat").kind !== "allowed",
    compactDisabled: !activeThread || activePanelOperationDecision(state, "compact").kind !== "allowed",
    goalMutationDisabled: activePanelOperationDecision(state, "goal-mutation").kind === "blocked",
    turnBusy: chatTurnBusy(state.activeTurn),
    availableSkills: shared.skills,
    initializeResponse: state.connection.initializeResponse,
    metadataDiagnostics: shared.metadataDiagnostics,
    toolInventory: shared.toolInventory,
    toolbarPanel: state.ui.toolbarPanel,
    archiveConfirmThreadId: state.ui.archiveConfirmThreadId,
    rename: state.ui.rename,
  };
}
