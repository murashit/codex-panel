import type { CollaborationMode } from "../generated/app-server/CollaborationMode";
import type { ModeKind } from "../generated/app-server/ModeKind";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ThreadSettingsUpdateParams } from "../generated/app-server/v2/ThreadSettingsUpdateParams";
import type { ApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";

export type ThreadSettingsUpdate = Omit<ThreadSettingsUpdateParams, "threadId">;
export type AppServerApprovalsReviewer = ApprovalsReviewer;
export type ServiceTier = string;
export type ServiceTierRequest = string | null | undefined;

export function applyThreadSettingsValue<K extends keyof ThreadSettingsUpdate>(
  update: ThreadSettingsUpdate,
  key: K,
  value: ThreadSettingsUpdate[K] | undefined,
): void {
  if (value !== undefined) update[key] = value;
}

export function appServerApprovalsReviewerOrNull(value: unknown): AppServerApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function appServerAutoReviewApprovalsReviewer(enabled: boolean): AppServerApprovalsReviewer {
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
