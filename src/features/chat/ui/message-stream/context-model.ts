import type { ChatState } from "../../state/reducer";
import { chatTurnBusy } from "../../state/reducer";
import type { DisplayItem } from "../../display/types";
import {
  forkCandidatesFromItems,
  implementPlanCandidateFromState,
  isForkCandidateItem,
  isRollbackCandidateItem,
  rollbackCandidateFromItems,
} from "../../display/action-candidates";
import type { MessageStreamContext } from "./context";
import type { ChatMessageStreamContextPort } from "./ports";

export function createMessageStreamContext(state: ChatState, port: ChatMessageStreamContextPort): MessageStreamContext {
  const busy = chatTurnBusy(state);
  const rollbackCandidate = busy ? null : rollbackCandidateFromItems(state.transcript.displayItems);
  const forkCandidates = busy ? [] : forkCandidatesFromItems(state.transcript.displayItems);
  const implementPlanCandidate = implementPlanCandidateFromState(state);

  return {
    activeThreadId: state.activeThread.id,
    turnLifecycle: state.turn.lifecycle,
    historyCursor: state.transcript.historyCursor,
    loadingHistory: state.transcript.loadingHistory,
    displayItems: state.transcript.displayItems,
    turnDiffs: state.transcript.turnDiffs,
    workspaceRoot: state.activeThread.cwd ?? port.vaultPath,
    openDetails: state.ui.openDetails,
    onDetailsToggle: port.setOpenDetail,
    loadOlderTurns: port.loadOlderTurns,
    renderMarkdown: port.renderMarkdown,
    copyText: port.copyMessageText,
    canImplementPlanItem: (item: DisplayItem) => item.id === implementPlanCandidate?.id,
    onImplementPlanItem: (item) => {
      port.actions.implementPlan(item);
    },
    canRollbackItem: (item: DisplayItem) => isRollbackCandidateItem(item, rollbackCandidate),
    onRollbackItem: () => {
      if (state.activeThread.id) port.actions.rollbackThread(state.activeThread.id);
    },
    canForkItem: (item: DisplayItem) => isForkCandidateItem(item, forkCandidates),
    onForkItem: (item, archiveSource) => {
      if (state.activeThread.id && item.turnId) {
        port.actions.forkThreadFromTurn(state.activeThread.id, item.turnId, archiveSource);
      }
    },
    openTurnDiff: (turnDiffState) => {
      port.actions.openTurnDiff(turnDiffState);
    },
    pendingRequests: {
      signature: port.requests.pendingSignature(),
      snapshot: port.requests.pendingSnapshot,
      actions: port.requests.pendingActions,
      consumeAutoFocus: port.requests.consumePendingAutoFocus,
    },
  };
}
