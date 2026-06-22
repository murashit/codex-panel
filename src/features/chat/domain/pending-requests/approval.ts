import type { ApprovalDetailRow, PendingApproval } from "../../../../domain/pending-requests/model";

export function approvalTitle(approval: PendingApproval): string {
  return approval.title;
}

export function approvalSummary(approval: PendingApproval): string {
  return approval.summary;
}

export function approvalResultSummary(approval: PendingApproval): string {
  return approval.resultSummary;
}

export function approvalDetails(approval: PendingApproval): ApprovalDetailRow[] {
  return [...approval.details];
}
