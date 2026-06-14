import type { ApprovalAction, PendingApproval, PendingRequestId, PendingUserInput } from "../../domain/pending-requests/model";

export type { PendingRequestId } from "../../domain/pending-requests/model";

export interface PendingRequestBlockState {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export interface PendingRequestBlockActions {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  setApprovalDetailsExpanded?: (requestId: PendingRequestId, expanded: boolean) => void;
  setUserInputDraft: (key: string, value: string) => void;
}
