import type { ConfigReadResponse as AppServerConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Config as AppServerConfig } from "../generated/app-server/v2/Config";
import {
  appServerApprovalsReviewerOrNull,
  parseServiceTier,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type ServiceTier,
} from "./thread-settings";
import { isReasoningEffort, type ReasoningEffort } from "../domain/catalog/metadata";

type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
type Verbosity = "low" | "medium" | "high";
type WebSearchMode = "disabled" | "cached" | "live";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ActivePermissionProfile {
  id: string;
  extends: string | null;
}

export interface RuntimeConfigSnapshot {
  profile: string | null;
  model: string | null;
  modelProvider: string | null;
  reasoningEffort: ReasoningEffort | null;
  rawReasoningEffort: string | null;
  reasoningSummary: ReasoningSummary | null;
  verbosity: Verbosity | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  approvalPolicy: ApprovalPolicy | null;
  webSearch: WebSearchMode | null;
  modelContextWindow: number | null;
  autoCompactTokenLimit: number | null;
  sandboxMode: SandboxMode | null;
  workspaceNetworkAccess: boolean | null;
  writableRoots: readonly string[] | null;
  toolWebSearch: unknown;
  apps: unknown;
}

export function emptyRuntimeConfigSnapshot(): RuntimeConfigSnapshot {
  return {
    profile: null,
    model: null,
    modelProvider: null,
    reasoningEffort: null,
    rawReasoningEffort: null,
    reasoningSummary: null,
    verbosity: null,
    serviceTier: null,
    approvalsReviewer: null,
    approvalPolicy: null,
    webSearch: null,
    modelContextWindow: null,
    autoCompactTokenLimit: null,
    sandboxMode: null,
    workspaceNetworkAccess: null,
    writableRoots: null,
    toolWebSearch: null,
    apps: null,
  };
}

export function runtimeConfigSnapshotFromAppServerConfig(response: AppServerConfigReadResponse): RuntimeConfigSnapshot {
  const config = asConfigRecord(response.config);
  const tools = asRecordOrNull(config.tools);
  const workspaceWrite = asRecordOrNull(config.sandbox_workspace_write);
  const effort = config.model_reasoning_effort;
  return {
    profile: selectedConfigProfile(response.layers),
    model: nonEmptyStringOrNull(config.model),
    modelProvider: nonEmptyStringOrNull(config.model_provider),
    reasoningEffort: isReasoningEffort(effort) ? effort : null,
    rawReasoningEffort: nonEmptyStringOrNull(effort),
    reasoningSummary: reasoningSummaryOrNull(config.model_reasoning_summary),
    verbosity: verbosityOrNull(config.model_verbosity),
    serviceTier: parseServiceTier(config.service_tier),
    approvalsReviewer: appServerApprovalsReviewerOrNull(config.approvals_reviewer),
    approvalPolicy: approvalPolicyOrNull(config.approval_policy),
    webSearch: webSearchModeOrNull(config.web_search),
    modelContextWindow: numberOrNull(config.model_context_window),
    autoCompactTokenLimit: numberOrNull(config.model_auto_compact_token_limit),
    sandboxMode: sandboxModeOrNull(config.sandbox_mode),
    workspaceNetworkAccess: booleanOrNull(workspaceWrite?.["network_access"]),
    writableRoots: stringArrayOrNull(workspaceWrite?.["writable_roots"]),
    toolWebSearch: cloneJsonLike(asRecordOrNull(tools?.["web_search"])),
    apps: cloneJsonLike(asRecordOrNull(config.apps)),
  };
}

export function cloneRuntimeConfigSnapshot(config: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  return {
    ...config,
    approvalPolicy: cloneApprovalPolicy(config.approvalPolicy),
    writableRoots: config.writableRoots ? [...config.writableRoots] : null,
    toolWebSearch: cloneJsonLike(config.toolWebSearch),
    apps: cloneJsonLike(config.apps),
  };
}

type ConfigProjectionRecord = Partial<AppServerConfig> & Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asConfigRecord(value: unknown): ConfigProjectionRecord {
  return asRecord(value) as ConfigProjectionRecord;
}

function selectedConfigProfile(layers: AppServerConfigReadResponse["layers"]): string | null {
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

function approvalPolicyOrNull(value: unknown): ApprovalPolicy | null {
  if (value === "untrusted" || value === "on-failure" || value === "on-request" || value === "never") return value;
  const granular = asRecordOrNull(asRecordOrNull(value)?.["granular"]);
  if (!granular) return null;
  const sandboxApproval = granular["sandbox_approval"];
  const rules = granular["rules"];
  const skillApproval = granular["skill_approval"];
  const requestPermissions = granular["request_permissions"];
  const mcpElicitations = granular["mcp_elicitations"];
  if (
    typeof sandboxApproval !== "boolean" ||
    typeof rules !== "boolean" ||
    typeof skillApproval !== "boolean" ||
    typeof requestPermissions !== "boolean" ||
    typeof mcpElicitations !== "boolean"
  ) {
    return null;
  }
  return {
    granular: {
      sandbox_approval: sandboxApproval,
      rules,
      skill_approval: skillApproval,
      request_permissions: requestPermissions,
      mcp_elicitations: mcpElicitations,
    },
  };
}

function cloneApprovalPolicy(value: ApprovalPolicy | null): ApprovalPolicy | null {
  return value && typeof value === "object" ? { granular: { ...value.granular } } : value;
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]));
}
