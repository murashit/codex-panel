import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../../../domain/pending-requests/model";
import {
  pendingApprovalViewModel,
  pendingMcpElicitationViewModel,
  pendingUserInputViewModel,
  type PendingApprovalViewModel,
  type PendingMcpElicitationViewModel,
  type PendingUserInputViewModel,
} from "./view-model";

export interface PendingRequestBlockSnapshot {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

interface PendingRequestBlockSnapshotSource {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  pendingMcpElicitations: readonly PendingMcpElicitation[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export function pendingRequestBlockSnapshotFromState(source: PendingRequestBlockSnapshotSource): PendingRequestBlockSnapshot {
  return {
    approvals: source.approvals.map(pendingApprovalViewModel),
    pendingUserInputs: source.pendingUserInputs.map(pendingUserInputViewModel),
    pendingMcpElicitations: source.pendingMcpElicitations.map(pendingMcpElicitationViewModel),
    userInputDrafts: source.userInputDrafts,
    mcpElicitationDrafts: source.mcpElicitationDrafts,
    approvalDetails: source.approvalDetails,
  };
}
