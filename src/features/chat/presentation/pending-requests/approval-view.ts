import {
  approvalActionKind,
  type ApprovalAction,
  type CommandApprovalDecision,
  type PendingApproval,
} from "../../domain/pending-requests/model";

export interface ApprovalActionOption {
  label: string;
  action: ApprovalAction;
  className: string;
}

export function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  if (approval.method !== "item/commandExecution/requestApproval") return defaultApprovalActionOptions();
  const decisions = approval.params.availableDecisions;
  if (!decisions || decisions.length === 0) return defaultApprovalActionOptions();
  return decisions.map((decision) => ({
    label: commandDecisionLabel(decision),
    action: { kind: "command-decision", decision },
    className: commandDecisionClassName(decision),
  }));
}

function defaultApprovalActionOptions(): ApprovalActionOption[] {
  return [
    { label: "Allow", action: "accept", className: "mod-cta" },
    { label: "Allow session", action: "accept-session", className: "" },
    { label: "Deny", action: "decline", className: "mod-warning" },
    { label: "Cancel", action: "cancel", className: "" },
  ];
}

function commandDecisionLabel(decision: CommandApprovalDecision): string {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow session";
  if (decision === "decline") return "Deny";
  if (decision === "cancel") return "Cancel";
  if ("acceptWithExecpolicyAmendment" in decision) return "Allow rule";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "Allow network rule" : "Deny network rule";
  }
  return "Choose";
}

function commandDecisionClassName(decision: CommandApprovalDecision): string {
  const kind = approvalActionKind({ kind: "command-decision", decision });
  if (kind === "accept") return "mod-cta";
  if (kind === "decline") return "mod-warning";
  return "";
}
