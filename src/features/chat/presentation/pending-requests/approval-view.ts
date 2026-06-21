import {
  approvalActionKind,
  type ApprovalAction,
  type CommandApprovalDecision,
  type PendingApproval,
} from "../../../../domain/pending-requests/model";

export interface ApprovalActionOption {
  id: string;
  label: string;
  action: ApprovalAction;
  className: string;
}

export function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  if (approval.method !== "item/commandExecution/requestApproval") return defaultApprovalActionOptions();
  const decisions = approval.params.availableDecisions;
  if (!decisions || decisions.length === 0) return defaultApprovalActionOptions();
  return decisions.map((decision, index) => ({
    id: `command-decision:${String(index)}:${commandDecisionKey(decision)}`,
    label: commandDecisionLabel(decision),
    action: { kind: "command-decision", decision },
    className: commandDecisionClassName(decision),
  }));
}

function defaultApprovalActionOptions(): ApprovalActionOption[] {
  return [
    { id: "accept", label: "Allow", action: "accept", className: "mod-cta" },
    { id: "accept-session", label: "Allow session", action: "accept-session", className: "" },
    { id: "decline", label: "Deny", action: "decline", className: "mod-warning" },
    { id: "cancel", label: "Cancel", action: "cancel", className: "" },
  ];
}

function commandDecisionLabel(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return simpleCommandDecisionLabel(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "Allow rule";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "Allow network rule" : "Deny network rule";
  }
  return "Choose";
}

function simpleCommandDecisionLabel(decision: string): string {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow session";
  if (decision === "decline") return "Deny";
  if (decision === "cancel") return "Cancel";
  return "Choose";
}

function commandDecisionKey(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return decision;
  if ("acceptWithExecpolicyAmendment" in decision) return "acceptWithExecpolicyAmendment";
  if ("applyNetworkPolicyAmendment" in decision) {
    const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    const host = amendment["host"];
    return `applyNetworkPolicyAmendment:${amendment.action}:${typeof host === "string" ? host : ""}`;
  }
  return "unknown";
}

function commandDecisionClassName(decision: CommandApprovalDecision): string {
  const kind = approvalActionKind({ kind: "command-decision", decision });
  if (kind === "accept") return "mod-cta";
  if (kind === "decline") return "mod-warning";
  return "";
}
