import type { ChatState } from "../../state/reducer";
import type { PendingApproval } from "../../protocol/server-requests/approval";
import type { PendingUserInput } from "../../protocol/server-requests/user-input";
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
  openDetails: ReadonlySet<string>;
}

export function pendingRequestBlockSnapshot(state: ChatState): PendingRequestBlockSnapshot {
  return pendingRequestBlockSnapshotFromRequests({
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    userInputDrafts: state.requests.userInputDrafts,
    openDetails: state.ui.openDetails,
  });
}

export function pendingRequestBlockSnapshotFromRequests(source: {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  openDetails: ReadonlySet<string>;
}): PendingRequestBlockSnapshot {
  return {
    approvals: source.approvals.map(pendingApprovalViewModel),
    pendingUserInputs: source.pendingUserInputs.map(pendingUserInputViewModel),
    userInputDrafts: source.userInputDrafts,
    openDetails: source.openDetails,
  };
}
