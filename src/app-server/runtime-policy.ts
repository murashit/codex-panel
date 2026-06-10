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

export interface ActivePermissionProfile {
  id: string;
  extends: string | null;
}

export function appServerApprovalsReviewerOrNull(value: unknown): ApprovalsReviewer | null {
  return value === "user" || value === "auto_review" || value === "guardian_subagent" ? value : null;
}

export function parseServiceTier(value: unknown): ServiceTier | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function approvalPolicyOrNull(value: unknown): ApprovalPolicy | null {
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

export function cloneApprovalPolicy(value: ApprovalPolicy | null): ApprovalPolicy | null {
  return value && typeof value === "object" ? { granular: { ...value.granular } } : value;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
