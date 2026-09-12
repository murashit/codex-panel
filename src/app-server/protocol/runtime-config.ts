import { normalizeReasoningEffort } from "../../domain/catalog/metadata";
import type { ReasoningSummary, RuntimeConfigSnapshot, Verbosity } from "../../domain/runtime/config";
import type { RuntimeApprovalPolicy, RuntimePermissionState, RuntimeSandboxPolicy } from "../../domain/runtime/permissions";
import { approvalsReviewerOrNull, parseServiceTier } from "../../domain/runtime/policy";

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
  const rawConfig = response.config;
  const config = rawConfig && typeof rawConfig === "object" ? (rawConfig as Record<string, unknown>) : {};
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
    startupPermissions: startupPermissionsFromConfig(config),
    modelContextWindow: numberOrNull(config["model_context_window"]),
    autoCompactTokenLimit: numberOrNull(config["model_auto_compact_token_limit"]),
  };
}

function startupPermissionsFromConfig(config: Record<string, unknown>): RuntimePermissionState {
  const activePermissionProfile = permissionProfileFromConfig(config);
  return {
    approvalPolicy: approvalPolicyOrNull(config["approval_policy"]),
    sandboxPolicy: activePermissionProfile ? null : sandboxPolicyFromConfig(config),
    activePermissionProfile,
  };
}

function permissionProfileFromConfig(config: Record<string, unknown>): RuntimePermissionState["activePermissionProfile"] {
  const profile = nonEmptyStringOrNull(config["default_permissions"]);
  return profile ? { id: profile, extends: null } : null;
}

function sandboxPolicyFromConfig(config: Record<string, unknown>): RuntimeSandboxPolicy | null {
  const mode = config["sandbox_mode"];
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  if (mode === "read-only") return { type: "readOnly", networkAccess: false };
  if (mode !== "workspace-write") return null;

  const workspaceWrite = recordOrNull(config["sandbox_workspace_write"]);
  return {
    type: "workspaceWrite",
    writableRoots: stringArrayOrEmpty(workspaceWrite?.["writable_roots"]),
    networkAccess: workspaceWrite?.["network_access"] === true,
    excludeTmpdirEnvVar: workspaceWrite?.["exclude_tmpdir_env_var"] === true,
    excludeSlashTmp: workspaceWrite?.["exclude_slash_tmp"] === true,
  };
}

function approvalPolicyOrNull(value: unknown): RuntimeApprovalPolicy | null {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  if (!value || typeof value !== "object") return null;
  const granular = (value as Record<string, unknown>)["granular"];
  if (!granular || typeof granular !== "object") return null;
  const granularRecord = granular as Record<string, unknown>;
  return {
    granular: {
      sandbox_approval: granularRecord["sandbox_approval"] === true,
      rules: granularRecord["rules"] === true,
      skill_approval: granularRecord["skill_approval"] === true,
      request_permissions: granularRecord["request_permissions"] === true,
      mcp_elicitations: granularRecord["mcp_elicitations"] === true,
    },
  };
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function reasoningSummaryOrNull(value: unknown): ReasoningSummary | null {
  return value === "auto" || value === "concise" || value === "detailed" || value === "none" ? value : null;
}

function verbosityOrNull(value: unknown): Verbosity | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}
