import type { ReasoningEffort } from "../../../generated/app-server/ReasoningEffort";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import type { RuntimeSnapshot } from "../../../runtime/state";
import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  fastModeActive,
  pendingRuntimeSettingLabel,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../../runtime/state";
import { readRuntimeConfig } from "../../../runtime/config";
import { sortedAvailableModels } from "../../../runtime/model";
import { compactReasoningEffortLabel } from "../../../runtime/settings";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../../../runtime/view";
import { codexPanelDisplayTitle, explicitThreadName, getThreadTitle } from "../../../domain/threads/model";
import type { ChatState } from "../chat-state";
import { connectionDiagnosticSections } from "../diagnostics";
import { statusValue, usageLimitStatusLines } from "../status-lines";
import type { ToolbarThreadRow, ToolbarViewModel } from "../toolbar-model";

export interface RuntimeSnapshotInput {
  state: ChatState;
}

export interface ComposerMetaViewModel {
  fatal: string | null;
  context: ComposerContextMeterViewModel;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  modelChoices?: RuntimeChoice[];
  effortChoices?: RuntimeChoice[];
}

export interface RuntimeChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

export interface ComposerContextMeterCellViewModel {
  text: string;
  placeholder: boolean;
}

export interface ComposerContextMeterViewModel {
  cells: ComposerContextMeterCellViewModel[];
  percent: string;
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
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}

export interface ConnectionDiagnosticsModelInput {
  state: ChatState;
  connected: boolean;
  configuredCommand: string;
}

export interface RuntimeComposerChoicesInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  setRequestedModel: (model: string | null) => void;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => void;
}

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export function runtimeSnapshotForChatState({ state }: RuntimeSnapshotInput): RuntimeSnapshot {
  return {
    effectiveConfig: state.connection.effectiveConfig,
    activeThreadId: state.activeThread.id,
    activeModel: state.runtime.activeModel,
    activeReasoningEffort: state.runtime.activeReasoningEffort,
    activeCollaborationMode: state.runtime.activeCollaborationMode,
    activeServiceTier: state.runtime.activeServiceTier,
    activeApprovalPolicy: state.runtime.activeApprovalPolicy,
    activeApprovalsReviewer: state.runtime.activeApprovalsReviewer,
    activePermissionProfile: state.runtime.activePermissionProfile,
    requestedModel: state.runtime.requestedModel,
    requestedReasoningEffort: state.runtime.requestedReasoningEffort,
    requestedApprovalsReviewer: state.runtime.requestedApprovalsReviewer,
    selectedCollaborationMode: state.runtime.selectedCollaborationMode,
    requestedServiceTier: state.runtime.requestedServiceTier,
    tokenUsage: state.activeThread.tokenUsage,
    rateLimit: state.connection.rateLimit,
    hasThreadTurns: state.transcript.displayItems.some((item) => item.turnId),
    availableModels: state.connection.availableModels,
  };
}

export function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: RuntimeChoice[];
  effortChoices: RuntimeChoice[];
} {
  const config = readRuntimeConfig(input.state.connection.effectiveConfig);
  const activeModel = currentModel(input.snapshot, config);
  const models = sortedAvailableModels(input.state.connection.availableModels);
  const modelChoices: RuntimeChoice[] = models.slice(0, 12).map((model) => ({
    label: model.model,
    selected: activeModel === model.model,
    onClick: () => {
      input.setRequestedModel(model.model);
    },
  }));
  if (models.length === 0) {
    modelChoices.push({
      label: "No model list available.",
      disabled: true,
      onClick: () => undefined,
    });
  }

  const activeEffort = currentReasoningEffort(input.snapshot, config);
  const effortChoices: RuntimeChoice[] = supportedReasoningEfforts(input.snapshot).map((effort) => ({
    label: effort,
    selected: activeEffort === effort,
    onClick: () => {
      input.setRequestedReasoningEffort(effort);
    },
  }));

  return { modelChoices, effortChoices };
}

export function chatViewDisplayTitle(state: ChatState, restoredThreadTitle: string | null): string {
  return codexPanelDisplayTitle(state.activeThread.id, state.threadList.listedThreads, restoredThreadTitle);
}

export function activeThreadTitle(state: ChatState): string | null {
  const threadId = state.activeThread.id;
  if (!threadId) return null;
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  return thread ? getThreadTitle(thread) : null;
}

export function activeComposerThreadName(state: ChatState, restoredThread: RestoredThreadTitleSnapshot | null): string | null {
  const threadId = state.activeThread.id;
  if (!threadId) return null;
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  const listedName = thread ? explicitThreadName(thread) : null;
  if (listedName) return listedName;
  return restoredThread?.threadId === threadId ? restoredThread.explicitName : null;
}

export function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function composerMetaViewModel(state: ChatState, snapshot: RuntimeSnapshot): ComposerMetaViewModel {
  if (state.connection.status === "Connection failed.") {
    return {
      fatal: "Codex app-server disconnected",
      context: contextComposerMeter(null),
      statusSummary: "Codex app-server disconnected",
      model: "",
      effort: null,
      planActive: false,
      autoReviewActive: false,
      fastActive: false,
    };
  }

  const config = readRuntimeConfig(state.connection.effectiveConfig);
  const context = contextSummary(snapshot);
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  const composerContext = contextComposerMeter(context?.percent ?? null);
  const compactEffort = effort ? compactReasoningEffortLabel(effort) : null;
  const planActive = state.runtime.selectedCollaborationMode === "plan";
  const reviewActive = autoReviewActive(snapshot, config);
  const fastActive = fastModeActive(snapshot, config);
  return {
    fatal: null,
    context: composerContext,
    statusSummary: composerStatusSummary({
      context: composerContext,
      model: model ?? "default",
      effort: compactEffort,
      planActive,
      autoReviewActive: reviewActive,
      fastActive,
    }),
    model: model ?? "default",
    effort: compactEffort,
    planActive,
    autoReviewActive: reviewActive,
    fastActive,
  };
}

function composerStatusSummary(input: {
  context: ComposerContextMeterViewModel;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
}): string {
  const context = input.context.percent === "--%" ? "Context unavailable" : `Context ${input.context.percent.trim()}`;
  return [
    context,
    `plan ${onOffLabel(input.planActive)}`,
    `auto-review ${onOffLabel(input.autoReviewActive)}`,
    `fast ${onOffLabel(input.fastActive)}`,
    `model ${input.model}`,
    `reasoning effort ${input.effort ?? "default"}`,
  ].join(", ");
}

function onOffLabel(active: boolean): string {
  return active ? "on" : "off";
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const limit = rateLimitSummary(snapshot);
  const historyOpen = state.ui.openDetails.has("history");
  const chatActionsOpen = state.ui.openDetails.has("chat-actions");
  const statusPanelOpen = state.ui.openDetails.has("status-panel");
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    rateLimit: limit,
    configSections: effectiveConfigSections(snapshot, input.vaultPath),
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: state.threadList.listedThreads,
      activeThreadId: state.activeThread.id,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
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

const CONTEXT_DOT_WIDTH = 4;
const CONTEXT_CELL_PERCENT = 100 / CONTEXT_DOT_WIDTH;
const CONTEXT_PARTIAL_DOTS = ["", "⣀", "⣤", "⣶", "⣿"] as const;
const CONTEXT_FULL_DOT = "⣿";
const CONTEXT_EMPTY_DOT = "⣀";

function contextComposerMeter(percent: number | null): ComposerContextMeterViewModel {
  const percentLabel = percent === null ? "--%" : `${String(Math.round(Math.max(0, Math.min(100, percent)))).padStart(2, " ")}%`;
  return {
    cells: contextBrailleCells(percent),
    percent: percentLabel,
  };
}

function contextBrailleCells(percent: number | null): ComposerContextMeterCellViewModel[] {
  if (percent === null) return Array.from({ length: CONTEXT_DOT_WIDTH }, () => ({ text: CONTEXT_EMPTY_DOT, placeholder: true }));
  const clamped = Math.max(0, Math.min(100, percent));
  const cells: ComposerContextMeterCellViewModel[] = [];
  for (let index = 0; index < CONTEXT_DOT_WIDTH; index += 1) {
    const remaining = clamped - index * CONTEXT_CELL_PERCENT;
    if (remaining <= 0) {
      cells.push({ text: CONTEXT_EMPTY_DOT, placeholder: true });
      continue;
    }
    const partialIndex = Math.min(CONTEXT_PARTIAL_DOTS.length - 1, Math.ceil((remaining / CONTEXT_CELL_PERCENT) * 4));
    cells.push({ text: CONTEXT_PARTIAL_DOTS[partialIndex] ?? CONTEXT_FULL_DOT, placeholder: false });
  }
  return cells;
}

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    activeThreadCreationCliVersion: input.state.activeThread.creationCliVersion,
    diagnostics: input.state.connection.appServerDiagnostics,
  });
}

export function statusSummaryLines(state: ChatState, snapshot: RuntimeSnapshot): string[] {
  const context = contextSummary(snapshot);
  const limit = rateLimitSummary(snapshot);
  return [
    "Thread status",
    `Thread: ${state.activeThread.id ?? "(none)"}`,
    context ? context.title : "Context: not available",
    ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
  ];
}

export function modelStatusLines(state: ChatState, snapshot: RuntimeSnapshot, collaborationModeLabel: string): string[] {
  const config = readRuntimeConfig(state.connection.effectiveConfig);
  return [
    `Model: ${currentModel(snapshot, config) ?? "(Codex default)"}`,
    `Override: ${pendingRuntimeSettingLabel(state.runtime.requestedModel)}`,
    `Provider: ${statusValue(config.modelProvider, "(Codex default)")}`,
    `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
    `Mode: ${collaborationModeLabel}`,
    `Service tier: ${serviceTierLabel(snapshot, config)}`,
  ];
}

export function effortStatusLines(state: ChatState, snapshot: RuntimeSnapshot): string[] {
  const config = readRuntimeConfig(state.connection.effectiveConfig);
  return [
    `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
    `Override: ${pendingRuntimeSettingLabel(state.runtime.requestedReasoningEffort)}`,
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
