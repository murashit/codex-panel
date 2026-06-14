import type { PendingApproval, PendingUserInput } from "../../domain/pending-requests/model";
import {
  pendingApprovalViewModel,
  pendingUserInputViewModel,
  type PendingApprovalViewModel,
  type PendingUserInputViewModel,
} from "./view-model";

export interface PendingRequestBlockSnapshot {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export interface PendingRequestBlockSnapshotSource {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export function pendingRequestBlockSnapshotFromState(source: PendingRequestBlockSnapshotSource): PendingRequestBlockSnapshot {
  return {
    approvals: source.approvals.map(pendingApprovalViewModel),
    pendingUserInputs: source.pendingUserInputs.map(pendingUserInputViewModel),
    userInputDrafts: source.userInputDrafts,
    approvalDetails: source.approvalDetails,
  };
}
