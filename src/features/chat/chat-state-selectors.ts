import type { ChatState } from "./chat-state";
import type { PendingApproval } from "./requests/approvals/model";
import type { PendingUserInput } from "./requests/user-input/model";

export interface PendingRequestSnapshot {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  openDetails: ReadonlySet<string>;
}

export function pendingRequestSnapshot(state: ChatState): PendingRequestSnapshot {
  return {
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    userInputDrafts: state.requests.userInputDrafts,
    openDetails: state.ui.openDetails,
  };
}
