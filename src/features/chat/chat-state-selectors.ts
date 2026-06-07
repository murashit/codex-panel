import { chatTurnBusy } from "./chat-state";
import type { ChatState } from "./chat-state";
import type { Thread } from "../../generated/app-server/v2/Thread";
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

export function activeThreadId(state: ChatState): string | null {
  return state.activeThread.id;
}

export function canSwitchToThread(state: ChatState, threadId: string): boolean {
  return !chatTurnBusy(state) || threadId === state.activeThread.id;
}

export function listedThreads(state: ChatState): readonly Thread[] {
  return state.threadList.listedThreads;
}

export function displayItemsEmpty(state: ChatState): boolean {
  return state.transcript.displayItems.length === 0;
}
