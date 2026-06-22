import { approvalActionKind, type ApprovalAction, type PendingApproval } from "../../../../domain/pending-requests/model";

export interface ApprovalActionOption {
  id: string;
  label: string;
  action: ApprovalAction;
  className: string;
}

export function approvalActionOptions(approval: PendingApproval): ApprovalActionOption[] {
  const options = approval.actionOptions;
  if (!options || options.length === 0) return defaultApprovalActionOptions();
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    action: option.action,
    className: approvalActionClassName(option.action),
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

function approvalActionClassName(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "mod-cta";
  if (kind === "decline") return "mod-warning";
  return "";
}
