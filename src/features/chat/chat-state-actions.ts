import type { InitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { PanelThread } from "../../domain/threads/model";
import type { ThreadTokenUsage } from "../../generated/app-server/v2/ThreadTokenUsage";
import type { ChatAction, PendingTurnStart } from "./chat-state";
import type { DisplayItem } from "./display/types";

export function connectionInitializedAction(initializeResponse: InitializeResponse): ChatAction {
  return { type: "connection/initialized", initializeResponse };
}

export function clearConnectionScopeAction(): ChatAction {
  return { type: "connection/scoped-cleared" };
}

export function clearLocalTurnAction(): ChatAction {
  return { type: "turn/scoped-cleared" };
}

export function setRequestedCollaborationModeDefaultAction(): ChatAction {
  return { type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" };
}

export function clearActiveThreadAction(): ChatAction {
  return { type: "active-thread/cleared" };
}

export function applyThreadListAction(threads: readonly PanelThread[], threadsLoaded?: boolean): ChatAction {
  return { type: "thread-list/applied", threads, ...(threadsLoaded === undefined ? {} : { threadsLoaded }) };
}

export function restoreThreadPlaceholderAction(threadId: string, item: DisplayItem): ChatAction {
  return { type: "active-thread/restored-placeholder", threadId, item };
}

export function setActiveThreadTokenUsageAction(tokenUsage: ThreadTokenUsage): ChatAction {
  return { type: "active-thread/token-usage-set", tokenUsage };
}

export function closePanelsAction(): ChatAction {
  return { type: "ui/panel-set", panel: null };
}

export function setDetailOpenAction(key: string, open: boolean): ChatAction {
  return { type: "ui/detail-open-set", key, open };
}

export function setUserInputDraftAction(key: string, value: string): ChatAction {
  return { type: "request/user-input-draft-set", key, value };
}

export function optimisticTurnStartedAction(item: DisplayItem, pendingTurnStart: PendingTurnStart): ChatAction {
  return { type: "turn/optimistic-started", item, pendingTurnStart };
}

export function turnStartAcknowledgedAction(turnId: string, displayItems: readonly DisplayItem[]): ChatAction {
  return { type: "turn/start-acknowledged", turnId, displayItems };
}

export function turnStartFailedAction(displayItems: readonly DisplayItem[]): ChatAction {
  return { type: "turn/start-failed", displayItems };
}

export function addTranscriptItemAction(item: DisplayItem): ChatAction {
  return { type: "transcript/item-added", item };
}
