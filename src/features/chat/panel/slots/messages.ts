import { pendingRequestsSignature as requestStateSignature } from "../../requests/view-model";
import type { ChatViewSlotRendererPorts } from "./types";

export function renderMessagesSlot(parent: HTMLElement, ports: ChatViewSlotRendererPorts): void {
  ports.slots.renderMessages(parent);
}

export function pendingRequestsSignature(ports: ChatViewSlotRendererPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
