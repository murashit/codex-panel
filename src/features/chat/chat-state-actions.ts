import type { ChatAction } from "./chat-state";

export function closePanelsAction(): ChatAction {
  return { type: "ui/panel-set", panel: null };
}

export function pinMessagesToBottomAction(): ChatAction {
  return { type: "ui/messages-pinned-set", pinned: true };
}
