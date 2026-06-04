import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { RuntimeSnapshot } from "../../runtime/state";
import {
  autoReviewActive,
  currentModel,
  currentReasoningEffort,
  fastModeActive,
  pendingRuntimeSettingLabel,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../runtime/state";
import { readRuntimeConfig } from "../../runtime/config";
import { sortedAvailableModels } from "../../runtime/model";
import { compactReasoningEffortLabel } from "../../runtime/settings";
import { contextSummary, effectiveConfigSections, rateLimitSummary } from "../../runtime/view";
import { codexPanelDisplayTitle, explicitThreadName, getThreadTitle } from "../../domain/threads/model";
import { connectionDiagnosticSections } from "./diagnostics";
import type { ChatState } from "./chat-state";
import { statusValue, usageLimitStatusLines } from "./status-lines";
import type { ToolbarChoice, ToolbarThreadRow, ToolbarViewModel } from "./toolbar-model";

export interface RuntimeSnapshotInput {
  state: ChatState;
}

export interface ComposerMetaViewModel {
  fatal: string | null;
  contextIndicator: string;
  runtime: string;
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

export interface RuntimeToolbarChoicesInput {
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
    selectedCollaborationMode: state.selectedCollaborationMode,
    requestedServiceTier: state.requestedServiceTier,
    tokenUsage: state.tokenUsage,
    rateLimit: state.rateLimit,
    hasThreadTurns: state.displayItems.some((item) => item.turnId),
    availableModels: state.availableModels,
  };
}

export function runtimeToolbarChoices(input: RuntimeToolbarChoicesInput): Pick<ToolbarViewModel, "modelChoices" | "effortChoices"> {
  const config = readRuntimeConfig(input.state.effectiveConfig);
  const activeModel = currentModel(input.snapshot, config);
  const models = sortedAvailableModels(input.state.availableModels);
  const modelChoices: ToolbarChoice[] = models.slice(0, 12).map((model) => ({
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
  const effortChoices: ToolbarChoice[] = supportedReasoningEfforts(input.snapshot).map((effort) => ({
    label: effort,
    selected: activeEffort === effort,
    onClick: () => {
      input.setRequestedReasoningEffort(effort);
    },
  }));

  return { modelChoices, effortChoices };
}

export function chatViewDisplayTitle(state: ChatState, restoredThreadTitle: string | null): string {
  return codexPanelDisplayTitle(state.activeThreadId, state.listedThreads, restoredThreadTitle);
}

export function activeThreadTitle(state: ChatState): string | null {
  const threadId = state.activeThreadId;
  if (!threadId) return null;
  const thread = state.listedThreads.find((item) => item.id === threadId);
  return thread ? getThreadTitle(thread) : null;
}

export function activeComposerThreadName(state: ChatState, restoredThread: RestoredThreadTitleSnapshot | null): string | null {
  const threadId = state.activeThreadId;
  if (!threadId) return null;
  const thread = state.listedThreads.find((item) => item.id === threadId);
  const listedName = thread ? explicitThreadName(thread) : null;
  if (listedName) return listedName;
  return restoredThread?.threadId === threadId ? restoredThread.explicitName : null;
}

export function composerPlaceholder(threadName: string | null): string {
  return threadName ? `Ask Codex to work on “${threadName}”...` : "Ask Codex to work on this task...";
}

export function composerMetaViewModel(state: ChatState, snapshot: RuntimeSnapshot): ComposerMetaViewModel {
  if (state.status === "Connection failed.") {
    return {
      fatal: "Codex app-server disconnected",
      contextIndicator: "",
      runtime: "",
    };
  }

  const config = readRuntimeConfig(state.effectiveConfig);
  const context = contextSummary(snapshot);
  const model = currentModel(snapshot, config);
  const effort = currentReasoningEffort(snapshot, config);
  return {
    fatal: null,
    contextIndicator: brailleContextIndicator(context?.percent ?? null),
    runtime: runtimeComposerLabel(model, effort),
  };
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const config = readRuntimeConfig(state.effectiveConfig);
  const limit = rateLimitSummary(snapshot);
  const historyOpen = state.openDetails.has("history");
  const statusPanelOpen = state.openDetails.has("status-panel");
  const runtimeOpen = state.runtimePicker !== null;
  return {
    connected: input.connected,
    status: state.status,
    historyOpen,
    statusPanelOpen,
    runtimeOpen,
    planActive: state.selectedCollaborationMode === "plan",
    autoReviewActive: autoReviewActive(snapshot, config),
    fastActive: fastModeActive(snapshot, config),
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
  };
}

const CONTEXT_INDICATOR_WIDTH = 8;
const CONTEXT_BRAILLE_LEVELS = ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"] as const;

function brailleContextIndicator(percent: number | null): string {
  if (percent === null) return CONTEXT_BRAILLE_LEVELS[0].repeat(CONTEXT_INDICATOR_WIDTH);
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = (clamped / 100) * CONTEXT_INDICATOR_WIDTH;
  return Array.from({ length: CONTEXT_INDICATOR_WIDTH }, (_, index) => {
    const local = Math.max(0, Math.min(1, filled - index));
    const levelIndex = Math.round(local * (CONTEXT_BRAILLE_LEVELS.length - 1));
    return CONTEXT_BRAILLE_LEVELS[levelIndex];
  }).join("");
}

function runtimeComposerLabel(model: string | null, effort: ReasoningEffort | null): string {
  const modelLabel = model ?? "default";
  return effort ? `${modelLabel} ${compactReasoningEffortLabel(effort)}` : modelLabel;
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
    `Override: ${pendingRuntimeSettingLabel(state.requestedModel)}`,
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
    `Override: ${pendingRuntimeSettingLabel(state.requestedReasoningEffort)}`,
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
