import { activeTurnId as selectActiveTurnId, chatTurnBusy, pendingTurnStart } from "./chat-state";
import type { ChatState, PendingTurnStart } from "./chat-state";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { PendingApproval } from "./requests/approvals/model";
import type { PendingUserInput } from "./requests/user-input/model";
import type { DisplayItem } from "./display/types";
import { implementPlanCandidateFromState } from "./plan-implementation";

export interface PendingRequestSnapshot {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  openDetails: ReadonlySet<string>;
}

export interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  displayItems: readonly DisplayItem[];
  pendingTurnStart: PendingTurnStart | null;
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

export function submissionStateSnapshot(state: ChatState): SubmissionStateSnapshot {
  return {
    activeThreadId: state.activeThread.id,
    activeTurnId: selectActiveTurnId(state),
    busy: chatTurnBusy(state),
    listedThreads: state.threadList.listedThreads,
    displayItems: state.transcript.displayItems,
    pendingTurnStart: pendingTurnStart(state),
  };
}

export function canImplementPlan(state: ChatState, item: DisplayItem): boolean {
  return item.id === implementPlanCandidateFromState(state)?.id;
}
