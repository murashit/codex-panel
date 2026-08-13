export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type ServiceTier = string;

export function approvalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function parseServiceTier(value: unknown): ServiceTier | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
