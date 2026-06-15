import { approvalPolicyOrNull, approvalsReviewerOrNull, parseServiceTier } from "../../domain/runtime/policy";
import { normalizedRuntimeReasoningEffort } from "../../domain/runtime/config";
import type { ReasoningSummary, SandboxMode, RuntimeConfigSnapshot, Verbosity, WebSearchMode } from "../../domain/runtime/config";

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
  const config = asConfigRecord(response.config);
  const tools = asRecordOrNull(config["tools"]);
  const workspaceWrite = asRecordOrNull(config["sandbox_workspace_write"]);
  const effort = config["model_reasoning_effort"];
  return {
    profile: selectedConfigProfile(response.layers),
    model: nonEmptyStringOrNull(config["model"]),
    modelProvider: nonEmptyStringOrNull(config["model_provider"]),
    reasoningEffort: normalizedRuntimeReasoningEffort(effort),
    rawReasoningEffort: nonEmptyStringOrNull(effort),
    reasoningSummary: reasoningSummaryOrNull(config["model_reasoning_summary"]),
    verbosity: verbosityOrNull(config["model_verbosity"]),
    serviceTier: parseServiceTier(config["service_tier"]),
    approvalsReviewer: approvalsReviewerOrNull(config["approvals_reviewer"]),
    approvalPolicy: approvalPolicyOrNull(config["approval_policy"]),
    webSearch: webSearchModeOrNull(config["web_search"]),
    modelContextWindow: numberOrNull(config["model_context_window"]),
    autoCompactTokenLimit: numberOrNull(config["model_auto_compact_token_limit"]),
    sandboxMode: sandboxModeOrNull(config["sandbox_mode"]),
    workspaceNetworkAccess: booleanOrNull(workspaceWrite?.["network_access"]),
    writableRoots: stringArrayOrNull(workspaceWrite?.["writable_roots"]),
    rawToolWebSearch: cloneJsonLike(asRecordOrNull(tools?.["web_search"])),
    rawApps: cloneJsonLike(asRecordOrNull(config["apps"])),
  };
}

type ConfigProjectionRecord = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asConfigRecord(value: unknown): ConfigProjectionRecord {
  return asRecord(value);
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

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

function reasoningSummaryOrNull(value: unknown): ReasoningSummary | null {
  return value === "auto" || value === "concise" || value === "detailed" || value === "none" ? value : null;
}

function verbosityOrNull(value: unknown): Verbosity | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function webSearchModeOrNull(value: unknown): WebSearchMode | null {
  return value === "disabled" || value === "cached" || value === "live" ? value : null;
}

function sandboxModeOrNull(value: unknown): SandboxMode | null {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : null;
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]));
}
