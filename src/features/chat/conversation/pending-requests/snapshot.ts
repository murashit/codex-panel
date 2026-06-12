import type { ChatState } from "../../state/reducer";
import type { PendingApproval } from "../../protocol/requests/approval";
import type { PendingUserInput } from "../../protocol/requests/user-input";

export interface PendingRequestBlockSnapshot {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  openDetails: ReadonlySet<string>;
}

export function pendingRequestBlockSnapshot(state: ChatState): PendingRequestBlockSnapshot {
  return {
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    userInputDrafts: state.requests.userInputDrafts,
    openDetails: state.ui.openDetails,
  };
}
