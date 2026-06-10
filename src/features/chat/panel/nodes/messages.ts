import { pendingRequestsSignature as requestStateSignature } from "../../requests/view-model";
import type { ChatPanelMessagesPorts } from "./types";

export function pendingRequestsSignature(ports: ChatPanelMessagesPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
