import type { ApprovalsReviewer as AppServerApprovalsReviewer } from "../generated/app-server/v2/ApprovalsReviewer";

export type ApprovalsReviewer = AppServerApprovalsReviewer;
export type AutoReviewState = "enabled" | "disabled";

export function approvalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function isAutoReviewReviewer(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

export function nextAutoReviewState(active: boolean): AutoReviewState {
  return active ? "disabled" : "enabled";
}

export function autoReviewReviewerForState(state: AutoReviewState): ApprovalsReviewer {
  return state === "enabled" ? "auto_review" : "user";
}

export function autoReviewToggleMessage(state: AutoReviewState): string {
  return state === "enabled" ? "Auto-review on for subsequent turns." : "Auto-review off for subsequent turns.";
}
