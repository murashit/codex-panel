import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ChatAction } from "./chat-state";

export function connectionInitializedAction(initializeResponse: InitializeResponse): ChatAction {
  return { type: "connection/initialized", initializeResponse };
}

export function clearConnectionScopeAction(): ChatAction {
  return { type: "connection/scoped-cleared" };
}

export function clearLocalTurnAction(): ChatAction {
  return { type: "turn/scoped-cleared" };
}

export function closePanelsAction(): ChatAction {
  return { type: "ui/panel-set", panel: null };
}

export function pinMessagesToBottomAction(): ChatAction {
  return { type: "ui/messages-pinned-set", pinned: true };
}

export function setDetailOpenAction(key: string, open: boolean): ChatAction {
  return { type: "ui/detail-open-set", key, open };
}

export function setUserInputDraftAction(key: string, value: string): ChatAction {
  return { type: "request/user-input-draft-set", key, value };
}
