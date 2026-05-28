import type { Thread } from "../../generated/app-server/v2/Thread";
import type { RuntimeSnapshot } from "../../runtime/state";
import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  runtimeOverrideLabel,
  runtimeSummaryLabel,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../runtime/state";
import { readRuntimeConfig } from "../../runtime/config";
import { compactContextLabel } from "../../runtime/settings";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../../runtime/view";
import { getThreadTitle } from "../../domain/threads/model";
import { connectionDiagnosticSections, diagnosticAlertLevel } from "./diagnostics";
import type { ChatState } from "./chat-state";
import { statusValue, usageLimitStatusLines } from "./status-lines";
import type { ToolbarChoice, ToolbarThreadRow, ToolbarViewModel } from "./ui/toolbar";

export interface RuntimeSnapshotInput {
  state: ChatState;
}

export interface ToolbarViewModelInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  modelChoices: ToolbarChoice[];
  effortChoices: ToolbarChoice[];
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}

export interface ConnectionDiagnosticsModelInput {
  state: ChatState;
  connected: boolean;
  configuredCommand: string;
}

export function runtimeSnapshotForChatState({ state }: RuntimeSnapshotInput): RuntimeSnapshot {
  return {
    effectiveConfig: state.effectiveConfig,
    activeThreadId: state.activeThreadId,
    activeModel: state.activeModel,
    activeReasoningEffort: state.activeReasoningEffort,
    activeCollaborationMode: state.activeCollaborationMode,
    activeServiceTier: state.activeServiceTier,
    activeApprovalPolicy: state.activeApprovalPolicy,
    activeApprovalsReviewer: state.activeApprovalsReviewer,
    activePermissionProfile: state.activePermissionProfile,
    requestedModel: state.requestedModel,
    requestedReasoningEffort: state.requestedReasoningEffort,
    requestedApprovalsReviewer: state.requestedApprovalsReviewer,
    requestedCollaborationMode: state.requestedCollaborationMode,
    requestedServiceTier: state.requestedServiceTier,
    tokenUsage: state.tokenUsage,
    rateLimit: state.rateLimit,
    hasThreadTurns: state.displayItems.some((item) => item.turnId),
    availableModels: state.availableModels,
  };
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const config = readRuntimeConfig(state.effectiveConfig);
  const context = contextSummary(snapshot);
  const limit = rateLimitSummary(snapshot);
  const historyOpen = state.openDetails.has("history");
  const statusPanelOpen = state.openDetails.has("status-panel");
  const runtimeOpen = state.runtimePicker !== null;
  const statusState = input.turnBusy ? "running" : input.connected ? "connected" : "offline";
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  return {
    connected: input.connected,
    status: state.status,
    statusState,
    historyOpen,
    statusPanelOpen,
    runtimeOpen,
    planActive: state.requestedCollaborationMode === "plan",
    autoReviewActive: autoReviewActive(snapshot, config),
    fastActive: currentServiceTier(snapshot, config) === "fast",
    runtimeSummary: runtimeSummaryLabel(model, effort),
    runtimeTitle: `Model: ${model ?? "(Codex default)"}; Effort: ${effort ?? "(Codex default)"}`,
    runtimeEmphasized: false,
    context: context ? { ...context, label: compactContextLabel(context.percent, context.label) } : null,
    rateLimit: limit,
    configSections: effectiveConfigSections(snapshot, input.vaultPath),
    openPanel: historyOpen ? "history" : runtimeOpen ? "runtime" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: state.listedThreads,
      activeThreadId: state.activeThreadId,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: input.renameState,
    }),
    modelChoices: input.modelChoices,
    effortChoices: input.effortChoices,
    connectLabel: input.connected ? "Reconnect" : "Connect",
    diagnostics: connectionDiagnosticsModel({
      state,
      connected: input.connected,
      configuredCommand: input.configuredCommand,
    }),
    diagnosticAlertLevel: diagnosticAlertLevel(state.appServerDiagnostics),
  };
}

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.initializeResponse,
    activeThreadCreationCliVersion: input.state.activeThreadCreationCliVersion,
    diagnostics: input.state.appServerDiagnostics,
  });
}

export function statusSummaryLines(state: ChatState, snapshot: RuntimeSnapshot): string[] {
  const context = contextSummary(snapshot);
  const limit = rateLimitSummary(snapshot);
  return [
    "Thread status",
    `Thread: ${state.activeThreadId ?? "(none)"}`,
    context ? context.title : "Context: not available",
    ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
  ];
}

export function modelStatusLines(state: ChatState, snapshot: RuntimeSnapshot, collaborationModeLabel: string): string[] {
  const config = readRuntimeConfig(state.effectiveConfig);
  return [
    `Model: ${currentModel(snapshot, config) ?? "(Codex default)"}`,
    `Override: ${runtimeOverrideLabel(state.requestedModel)}`,
    `Provider: ${statusValue(config.modelProvider, "(Codex default)")}`,
    `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
    `Mode: ${collaborationModeLabel}`,
    `Service tier: ${serviceTierLabel(snapshot, config)}`,
  ];
}

export function effortStatusLines(state: ChatState, snapshot: RuntimeSnapshot): string[] {
  const config = readRuntimeConfig(state.effectiveConfig);
  return [
    `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
    `Override: ${runtimeOverrideLabel(state.requestedReasoningEffort)}`,
    `Supported: ${supportedReasoningEfforts(snapshot).join(", ")}`,
  ];
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
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
      rename: input.renameState(threadId),
    };
  });
}
