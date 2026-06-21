import type { ReasoningEffort } from "../catalog/metadata";
import { cloneApprovalPolicy, type ApprovalPolicy, type ApprovalsReviewer, type ServiceTier } from "./policy";

export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type Verbosity = "low" | "medium" | "high";
export type WebSearchMode = "disabled" | "cached" | "live";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface RuntimeConfigSnapshot {
  readonly profile: string | null;
  readonly model: string | null;
  readonly modelProvider: string | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly rawReasoningEffort: string | null;
  readonly reasoningSummary: ReasoningSummary | null;
  readonly verbosity: Verbosity | null;
  readonly serviceTier: ServiceTier | null;
  readonly approvalsReviewer: ApprovalsReviewer | null;
  readonly approvalPolicy: ApprovalPolicy | null;
  readonly webSearch: WebSearchMode | null;
  readonly modelContextWindow: number | null;
  readonly autoCompactTokenLimit: number | null;
  readonly sandboxMode: SandboxMode | null;
  readonly workspaceNetworkAccess: boolean | null;
  readonly writableRoots: readonly string[] | null;
  readonly rawToolWebSearch: unknown;
  readonly rawApps: unknown;
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

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonLike(item)]));
}
