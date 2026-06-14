import type { ChatState } from "../state/reducer";
import type { PendingRequestBlockState } from "./block";

export function pendingRequestBlockState(state: ChatState): PendingRequestBlockState {
  return {
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    userInputDrafts: state.requests.userInputDrafts,
    approvalDetails: state.ui.disclosures.approvalDetails,
  };
}
