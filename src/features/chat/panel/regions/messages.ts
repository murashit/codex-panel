import { pendingRequestsSignature as requestStateSignature } from "../../conversation/pending-requests/signatures";
import type { ChatPanelMessagesPorts } from "./ports";

export function chatPanelMessagesNode(ports: ChatPanelMessagesPorts) {
  return ports.render.node();
}

export function chatPanelPendingRequestsSignature(ports: ChatPanelMessagesPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
