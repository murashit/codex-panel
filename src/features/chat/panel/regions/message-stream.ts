import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import { pendingRequestsSignature as requestStateSignature } from "../../conversation/pending-requests/signatures";
import { useChatPanelShellState } from "../../ui/shell";
import type { ChatPanelMessageStreamPorts } from "./ports";

export function chatPanelMessageStreamRegionNode(ports: ChatPanelMessageStreamPorts): UiNode {
  return h(MessageStreamRegion, { ports });
}

function MessageStreamRegion({ ports }: { ports: ChatPanelMessageStreamPorts }): UiNode {
  const { activeThread, runtime, messageStream, requests, turn, ui, renderVersion } = useChatPanelShellState();
  void activeThread.value;
  void runtime.value;
  void messageStream.value;
  void requests.value;
  void turn.value;
  void ui.value;
  void renderVersion.value;
  return chatPanelMessageStreamNode(ports);
}

function chatPanelMessageStreamNode(ports: ChatPanelMessageStreamPorts) {
  return ports.render.node();
}

export function chatPanelMessageStreamPendingRequestsSignature(ports: ChatPanelMessageStreamPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
