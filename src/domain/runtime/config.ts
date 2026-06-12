import { normalizeReasoningEffort, type ReasoningEffort } from "../catalog/metadata";
import { cloneApprovalPolicy, type ApprovalPolicy, type ApprovalsReviewer, type ServiceTier } from "./policy";

export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type Verbosity = "low" | "medium" | "high";
export type WebSearchMode = "disabled" | "cached" | "live";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

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
  rawToolWebSearch: unknown;
  rawApps: unknown;
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
    rawToolWebSearch: null,
    rawApps: null,
  };
}

export function cloneRuntimeConfigSnapshot(config: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  return {
    ...config,
    approvalPolicy: cloneApprovalPolicy(config.approvalPolicy),
    writableRoots: config.writableRoots ? [...config.writableRoots] : null,
    rawToolWebSearch: cloneJsonLike(config.rawToolWebSearch),
    rawApps: cloneJsonLike(config.rawApps),
  };
}

export function normalizedRuntimeReasoningEffort(value: unknown): ReasoningEffort | null {
  return normalizeReasoningEffort(value);
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]));
}
