import type { ReasoningSummary } from "../../../generated/app-server/ReasoningSummary";
import type { Verbosity } from "../../../generated/app-server/Verbosity";
import type { WebSearchMode } from "../../../generated/app-server/WebSearchMode";
import type { ConfigReadResponse } from "../../../generated/app-server/v2/ConfigReadResponse";
import type { AppsConfig } from "../../../generated/app-server/v2/AppsConfig";
import type { AskForApproval } from "../../../generated/app-server/v2/AskForApproval";
import type { Config } from "../../../generated/app-server/v2/Config";
import type { SandboxMode } from "../../../generated/app-server/v2/SandboxMode";
import type { SandboxWorkspaceWrite } from "../../../generated/app-server/v2/SandboxWorkspaceWrite";
import type { ToolsV2 } from "../../../generated/app-server/v2/ToolsV2";
import { parseServiceTier, type ServiceTier } from "../../../app-server/service-tier";
import { isReasoningEffort, type ReasoningEffort } from "../../../domain/catalog/reasoning-effort";
import { approvalsReviewerOrNull, type ApprovalsReviewer } from "./approvals";

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
  toolWebSearch: ToolsV2["web_search"] | null;
  apps: AppsConfig | null;
}

export function readRuntimeConfig(effectiveConfig: ConfigReadResponse | null): RuntimeConfigProjection {
  const config = asConfigRecord(effectiveConfig?.config);
  const tools = config.tools ?? null;
  const workspaceWrite = config.sandbox_workspace_write ?? null;
  const effort = config.model_reasoning_effort;
  return {
    profile: selectedConfigProfile(effectiveConfig?.layers ?? null),
    model: nonEmptyStringOrNull(config.model),
    modelProvider: config.model_provider ?? null,
    reasoningEffort: isReasoningEffort(effort) ? effort : null,
    rawReasoningEffort: nonEmptyStringOrNull(effort),
    reasoningSummary: config.model_reasoning_summary ?? null,
    verbosity: config.model_verbosity ?? null,
    serviceTier: parseServiceTier(config.service_tier),
    approvalsReviewer: approvalsReviewerOrNull(config.approvals_reviewer),
    approvalPolicy: config.approval_policy ?? null,
    webSearch: config.web_search ?? null,
    modelContextWindow: numberOrNull(config.model_context_window),
    autoCompactTokenLimit: numberOrNull(config.model_auto_compact_token_limit),
    sandboxMode: config.sandbox_mode ?? null,
    workspaceNetworkAccess: workspaceWrite?.network_access ?? null,
    writableRoots: workspaceWrite?.writable_roots ?? null,
    toolWebSearch: tools?.web_search ?? null,
    apps: config.apps ?? null,
  };
}

type ConfigProjectionRecord = Partial<Config> & Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asConfigRecord(value: unknown): ConfigProjectionRecord {
  return asRecord(value) as ConfigProjectionRecord;
}

function selectedConfigProfile(layers: ConfigReadResponse["layers"]): string | null {
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
