import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";
import { parseServiceTier, type ServiceTier } from "../app-server/service-tier";
import { isReasoningEffort } from "./model";

export interface RuntimeConfigProjection {
  profile: string | null;
  model: string | null;
  modelProvider: unknown;
  reasoningEffort: ReasoningEffort | null;
  rawReasoningEffort: string | null;
  reasoningSummary: unknown;
  verbosity: unknown;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  approvalPolicy: unknown;
  webSearch: unknown;
  modelContextWindow: number | null;
  autoCompactTokenLimit: number | null;
  sandboxMode: unknown;
  workspaceNetworkAccess: unknown;
  writableRoots: unknown;
  hooksEnabled: unknown;
  applyPatchFreeformEnabled: unknown;
  toolWebSearch: unknown;
  apps: Record<string, unknown>;
}

export function readRuntimeConfig(effectiveConfig: ConfigReadResponse | null): RuntimeConfigProjection {
  const config = configRecord(effectiveConfig);
  const features = asRecord(config["features"]);
  const tools = asRecord(resolvedConfigValue(config, "tools"));
  const workspaceWrite = asRecord(config["sandbox_workspace_write"]);
  const effort = resolvedConfigValue(config, "model_reasoning_effort");
  return {
    profile: stringOrNull(config["profile"]),
    model: nonEmptyStringOrNull(resolvedConfigValue(config, "model")),
    modelProvider: resolvedConfigValue(config, "model_provider"),
    reasoningEffort: isReasoningEffort(effort) ? effort : null,
    rawReasoningEffort: nonEmptyStringOrNull(effort),
    reasoningSummary: resolvedConfigValue(config, "model_reasoning_summary"),
    verbosity: resolvedConfigValue(config, "model_verbosity"),
    serviceTier: parseServiceTier(resolvedConfigValue(config, "service_tier")),
    approvalsReviewer: approvalsReviewerOrNull(resolvedConfigValue(config, "approvals_reviewer")),
    approvalPolicy: resolvedConfigValue(config, "approval_policy"),
    webSearch: resolvedConfigValue(config, "web_search"),
    modelContextWindow: numberOrNull(config["model_context_window"]),
    autoCompactTokenLimit: numberOrNull(config["model_auto_compact_token_limit"]),
    sandboxMode: config["sandbox_mode"],
    workspaceNetworkAccess: workspaceWrite["network_access"],
    writableRoots: workspaceWrite["writable_roots"],
    hooksEnabled: features["hooks"],
    applyPatchFreeformEnabled: features["apply_patch_freeform"],
    toolWebSearch: tools["web_search"],
    apps: asRecord(config["apps"]),
  };
}

function configRecord(effectiveConfig: ConfigReadResponse | null): Record<string, unknown> {
  return fillMissingConfigValues(asRecord(effectiveConfig?.config), effectiveConfig?.layers ?? null);
}

function selectedProfileConfig(config: Record<string, unknown>): Record<string, unknown> {
  const profile = config["profile"];
  const profileName = typeof profile === "string" && profile.length > 0 ? profile : null;
  return profileName ? asRecord(asRecord(config["profiles"])[profileName]) : {};
}

function resolvedConfigValue(config: Record<string, unknown>, key: string): unknown {
  const profileValue = selectedProfileConfig(config)[key];
  return profileValue ?? config[key];
}

function approvalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function fillMissingConfigValues(config: Record<string, unknown>, layers: ConfigReadResponse["layers"]): Record<string, unknown> {
  if (!layers || layers.length === 0) return config;
  const fallback = rawLayerConfigRecord(layers);
  if (Object.keys(fallback).length === 0) return config;

  const merged = { ...config };
  for (const [key, value] of Object.entries(fallback)) {
    merged[key] ??= value;
  }
  return merged;
}

function rawLayerConfigRecord(layers: NonNullable<ConfigReadResponse["layers"]>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    const config = asRecord(layer.config);
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }
  return merged;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  return null;
}
