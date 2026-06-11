import {
  currentModel,
  currentReasoningEffort,
  runtimeConfigOrDefault,
  serviceTierLabel,
  supportedReasoningEfforts,
} from "../../runtime/effective-settings";
import { pendingRuntimeSettingLabel } from "../../runtime/model";
import { sortedModelMetadata } from "../../../../domain/catalog/metadata";
import { contextSummary, rateLimitSummary, type RateLimitSummary } from "../../runtime/status-summary";
import type {
  EffortStatusLinesInput,
  ModelStatusLinesInput,
  RuntimeChoice,
  RuntimeComposerChoicesInput,
  StatusSummaryLinesInput,
} from "./types";

export function runtimeComposerChoices(input: RuntimeComposerChoicesInput): {
  modelChoices: RuntimeChoice[];
  effortChoices: RuntimeChoice[];
} {
  const config = runtimeConfigOrDefault(input.state.connection.runtimeConfig);
  const activeModel = currentModel(input.snapshot, config);
  const models = sortedModelMetadata(input.state.connection.availableModels);
  const modelChoices: RuntimeChoice[] = models.slice(0, 12).map((model) => ({
    label: model.model,
    selected: activeModel === model.model,
    onClick: () => {
      input.requestModel(model.model);
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
  const effortChoices: RuntimeChoice[] = [
    {
      label: "Codex default",
      selected: activeEffort === null,
      onClick: () => {
        input.resetReasoningEffortToConfig();
      },
    },
    ...supportedReasoningEfforts(input.snapshot, config).map((effort) => ({
      label: effort,
      selected: activeEffort === effort,
      onClick: () => {
        input.requestReasoningEffort(effort);
      },
    })),
  ];

  return { modelChoices, effortChoices };
}

export function statusSummaryLines(input: StatusSummaryLinesInput): string[] {
  const context = contextSummary(input.snapshot);
  const limit = rateLimitSummary(input.snapshot);
  return [
    "Thread status",
    `Thread: ${input.activeThreadId ?? "(none)"}`,
    context ? context.title : "Context: not available",
    ...(limit ? usageLimitStatusLines(limit) : ["Usage limits: not available"]),
  ];
}

export function modelStatusLines(input: ModelStatusLinesInput): string[] {
  const config = runtimeConfigOrDefault(input.runtimeConfig);
  return [
    `Model: ${currentModel(input.snapshot, config) ?? "(Codex default)"}`,
    `Override: ${pendingRuntimeSettingLabel(input.requestedModel)}`,
    `Provider: ${statusValue(config.modelProvider, "(Codex default)")}`,
    `Effort: ${currentReasoningEffort(input.snapshot, config) ?? "(Codex default)"}`,
    `Mode: ${input.collaborationModeLabel}`,
    `Service tier: ${serviceTierLabel(input.snapshot, config)}`,
  ];
}

export function effortStatusLines(input: EffortStatusLinesInput): string[] {
  const config = runtimeConfigOrDefault(input.runtimeConfig);
  return [
    `Effort: ${currentReasoningEffort(input.snapshot, config) ?? "(Codex default)"}`,
    `Override: ${pendingRuntimeSettingLabel(input.requestedReasoningEffort)}`,
    `Supported: ${supportedReasoningEfforts(input.snapshot, config).join(", ")}`,
  ];
}

function statusValue(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value, fallback);
}

function usageLimitStatusLines(limit: RateLimitSummary): string[] {
  return ["Usage limits", ...limit.rows.map((row) => `${row.label}: ${row.value}${row.resetLabel ? ` (${row.resetLabel})` : ""}`)];
}

function jsonPreview(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}
