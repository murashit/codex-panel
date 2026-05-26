import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ReasoningSummary } from "../generated/app-server/ReasoningSummary";
import type { Verbosity } from "../generated/app-server/Verbosity";
import type { WebSearchMode } from "../generated/app-server/WebSearchMode";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { AppsConfig } from "../generated/app-server/v2/AppsConfig";
import type { AskForApproval } from "../generated/app-server/v2/AskForApproval";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";
import type { Config } from "../generated/app-server/v2/Config";
import type { ProfileV2 } from "../generated/app-server/v2/ProfileV2";
import type { SandboxMode } from "../generated/app-server/v2/SandboxMode";
import type { SandboxWorkspaceWrite } from "../generated/app-server/v2/SandboxWorkspaceWrite";
import type { ToolsV2 } from "../generated/app-server/v2/ToolsV2";
import { parseServiceTier, type ServiceTier } from "../app-server/service-tier";
import { isReasoningEffort } from "./model";

export interface RuntimeConfigProjection {
  profile: string | null;
  model: string | null;
  modelProvider: string | null;
  reasoningEffort: ReasoningEffort | null;
  rawReasoningEffort: string | null;
  reasoningSummary: ReasoningSummary | null;
  verbosity: Verbosity | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  approvalPolicy: AskForApproval | null;
  webSearch: WebSearchMode | null;
  modelContextWindow: number | null;
  autoCompactTokenLimit: number | null;
  sandboxMode: SandboxMode | null;
  workspaceNetworkAccess: SandboxWorkspaceWrite["network_access"] | null;
  writableRoots: SandboxWorkspaceWrite["writable_roots"] | null;
  hooksEnabled: unknown;
  applyPatchFreeformEnabled: unknown;
  toolWebSearch: ToolsV2["web_search"] | null;
  apps: AppsConfig | null;
}

export function readRuntimeConfig(effectiveConfig: ConfigReadResponse | null): RuntimeConfigProjection {
  const config = configRecord(effectiveConfig);
  const features = asRecord(config["features"]);
  const tools = resolvedConfigValue(config, "tools") ?? null;
  const workspaceWrite = config.sandbox_workspace_write ?? null;
  const effort = resolvedConfigValue(config, "model_reasoning_effort");
  return {
    profile: stringOrNull(config.profile),
    model: nonEmptyStringOrNull(resolvedConfigValue(config, "model")),
    modelProvider: resolvedConfigValue(config, "model_provider") ?? null,
    reasoningEffort: isReasoningEffort(effort) ? effort : null,
    rawReasoningEffort: nonEmptyStringOrNull(effort),
    reasoningSummary: resolvedConfigValue(config, "model_reasoning_summary") ?? null,
    verbosity: resolvedConfigValue(config, "model_verbosity") ?? null,
    serviceTier: parseServiceTier(resolvedConfigValue(config, "service_tier")),
    approvalsReviewer: approvalsReviewerOrNull(resolvedConfigValue(config, "approvals_reviewer")),
    approvalPolicy: resolvedConfigValue(config, "approval_policy") ?? null,
    webSearch: resolvedConfigValue(config, "web_search") ?? null,
    modelContextWindow: numberOrNull(config.model_context_window),
    autoCompactTokenLimit: numberOrNull(config.model_auto_compact_token_limit),
    sandboxMode: config.sandbox_mode ?? null,
    workspaceNetworkAccess: workspaceWrite?.network_access ?? null,
    writableRoots: workspaceWrite?.writable_roots ?? null,
    hooksEnabled: features["hooks"],
    applyPatchFreeformEnabled: features["apply_patch_freeform"],
    toolWebSearch: tools?.web_search ?? null,
    apps: config.apps ?? null,
  };
}

type ConfigProjectionRecord = Partial<Config> & Record<string, unknown>;
type ProfileProjectionRecord = Partial<ProfileV2> & Record<string, unknown>;

function configRecord(effectiveConfig: ConfigReadResponse | null): ConfigProjectionRecord {
  return fillMissingConfigValues(asConfigRecord(effectiveConfig?.config), effectiveConfig?.layers ?? null);
}

function selectedProfileConfig(config: ConfigProjectionRecord): ProfileProjectionRecord {
  const profile = config.profile;
  const profileName = typeof profile === "string" && profile.length > 0 ? profile : null;
  return profileName ? asProfileRecord(asRecord(config.profiles)[profileName]) : {};
}

function resolvedConfigValue<K extends keyof Config>(config: ConfigProjectionRecord, key: K): Config[K] | undefined {
  const profileValue = selectedProfileConfig(config)[key];
  return profileValue ?? config[key];
}

function approvalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asConfigRecord(value: unknown): ConfigProjectionRecord {
  return asRecord(value) as ConfigProjectionRecord;
}

function asProfileRecord(value: unknown): ProfileProjectionRecord {
  return asRecord(value) as ProfileProjectionRecord;
}

function fillMissingConfigValues(config: ConfigProjectionRecord, layers: ConfigReadResponse["layers"]): ConfigProjectionRecord {
  if (!layers || layers.length === 0) return config;
  const fallback = rawLayerConfigRecord(layers);
  if (Object.keys(fallback).length === 0) return config;

  const merged: ConfigProjectionRecord = { ...config };
  const mergedRecord = merged as Record<string, unknown>;
  for (const [key, value] of Object.entries(fallback)) {
    mergedRecord[key] ??= value;
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
