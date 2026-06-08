import { readRuntimeConfig } from "../../../../runtime/config";
import {
  currentModel,
  currentReasoningEffort,
  pendingRuntimeSettingLabel,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../../../runtime/effective-settings";
import { sortedAvailableModels } from "../../../../runtime/models";
import { contextSummary, rateLimitSummary } from "../../../../runtime/status-summary";
import type { ChatState } from "../../chat-state";
import { statusValue, usageLimitStatusLines } from "../../status-lines";
import type { RuntimeChoice, RuntimeComposerChoicesInput, RuntimeSnapshotInput } from "./types";

export function runtimeSnapshotForChatState({ state }: RuntimeSnapshotInput) {
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

export function statusSummaryLines(state: ChatState, snapshot: ReturnType<typeof runtimeSnapshotForChatState>): string[] {
  const context = contextSummary(snapshot);
  const limit = rateLimitSummary(snapshot);
  return [
    "Thread status",
    `Thread: ${state.activeThread.id ?? "(none)"}`,
    context ? context.title : "Context: not available",
    ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
  ];
}

export function modelStatusLines(
  state: ChatState,
  snapshot: ReturnType<typeof runtimeSnapshotForChatState>,
  collaborationModeLabel: string,
): string[] {
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

export function effortStatusLines(state: ChatState, snapshot: ReturnType<typeof runtimeSnapshotForChatState>): string[] {
  const config = readRuntimeConfig(state.connection.effectiveConfig);
  return [
    `Effort: ${currentReasoningEffort(snapshot, config) ?? "(Codex default)"}`,
    `Override: ${pendingRuntimeSettingLabel(state.runtime.requestedReasoningEffort)}`,
    `Supported: ${supportedReasoningEfforts(snapshot).join(", ")}`,
  ];
}
