import { normalizeReasoningEffort } from "../../domain/catalog/metadata";
import { approvalsReviewerOrNull, parseServiceTier } from "../../domain/runtime/policy";
import type { ReasoningSummary, RuntimeConfigSnapshot, Verbosity } from "../../domain/runtime/config";

interface ConfigLayerRecord {
  name: { type: string; profile?: unknown; [key: string]: unknown };
  config: unknown;
  [key: string]: unknown;
}

export interface ConfigReadResult {
  config: unknown;
  origins?: unknown;
  layers: readonly ConfigLayerRecord[] | null;
  [key: string]: unknown;
}

export function runtimeConfigSnapshotFromAppServerConfig(response: ConfigReadResult): RuntimeConfigSnapshot {
  const config = asRecord(response.config);
  const effort = config["model_reasoning_effort"];
  return {
    profile: selectedConfigProfile(response.layers),
    model: nonEmptyStringOrNull(config["model"]),
    modelProvider: nonEmptyStringOrNull(config["model_provider"]),
    reasoningEffort: normalizeReasoningEffort(effort),
    reasoningSummary: reasoningSummaryOrNull(config["model_reasoning_summary"]),
    verbosity: verbosityOrNull(config["model_verbosity"]),
    serviceTier: parseServiceTier(config["service_tier"]),
    approvalsReviewer: approvalsReviewerOrNull(config["approvals_reviewer"]),
    modelContextWindow: numberOrNull(config["model_context_window"]),
    autoCompactTokenLimit: numberOrNull(config["model_auto_compact_token_limit"]),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function selectedConfigProfile(layers: ConfigReadResult["layers"]): string | null {
  let selected: string | null = null;
  if (!layers) return null;
  for (const layer of layers) {
    const name = layer.name;
    if (name.type === "user" && typeof name.profile === "string" && name.profile.length > 0) {
      selected = name.profile;
    }
  }
  return selected;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function reasoningSummaryOrNull(value: unknown): ReasoningSummary | null {
  return value === "auto" || value === "concise" || value === "detailed" || value === "none" ? value : null;
}

function verbosityOrNull(value: unknown): Verbosity | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}
