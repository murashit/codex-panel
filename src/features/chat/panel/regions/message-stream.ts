import { pendingRequestsSignature as requestStateSignature } from "../../conversation/pending-requests/signatures";
import type { ChatPanelMessageStreamPorts } from "./ports";

export function chatPanelMessageStreamNode(ports: ChatPanelMessageStreamPorts) {
  return ports.render.node();
}

export function chatPanelMessageStreamPendingRequestsSignature(ports: ChatPanelMessageStreamPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
