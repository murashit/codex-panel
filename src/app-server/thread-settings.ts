import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { Personality } from "../generated/app-server/Personality";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ReasoningSummary } from "../generated/app-server/ReasoningSummary";
import type { SandboxPolicy } from "../generated/app-server/v2/SandboxPolicy";

export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type ApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    }
  | "never";
export type ServiceTier = string;
export type ServiceTierRequest = string | null | undefined;

export interface ThreadSettingsUpdate {
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxPolicy?: SandboxPolicy | null;
  permissions?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  summary?: ReasoningSummary | null;
  collaborationMode?: CollaborationMode | null;
  personality?: Personality | null;
}

export function applyThreadSettingsValue<K extends keyof ThreadSettingsUpdate>(
  update: ThreadSettingsUpdate,
  key: K,
  value: ThreadSettingsUpdate[K] | undefined,
): void {
  if (value !== undefined) update[key] = value;
}

export function appServerApprovalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function appServerAutoReviewApprovalsReviewer(enabled: boolean): ApprovalsReviewer {
  return enabled ? "auto_review" : "user";
}

export function appServerCollaborationMode(mode: ModeKind, model: string, reasoningEffort: ReasoningEffort | null): CollaborationMode {
  return {
    mode,
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function serviceTierRequestValue(value: ServiceTier): string {
  return value;
}

export function clearedServiceTierRequestValue(): null {
  return null;
}

export function configuredServiceTierRequestValue(value: ServiceTier | null): string | undefined {
  return value ?? undefined;
}
