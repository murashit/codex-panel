import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { Personality } from "../generated/app-server/Personality";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ReasoningSummary } from "../generated/app-server/ReasoningSummary";
import type { SandboxPolicy } from "../generated/app-server/v2/SandboxPolicy";
import type { ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "./runtime-policy";

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

export function serviceTierRequestValue(value: ServiceTier): string {
  return value;
}

export function clearedServiceTierRequestValue(): null {
  return null;
}
