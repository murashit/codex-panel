import { runtimeSnapshotForChatState } from "../../../../src/features/chat/application/runtime/snapshot";
import { activeTurnId, chatTurnBusy, type ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import {
  messageStreamActiveItems,
  messageStreamItems,
  messageStreamRollbackCandidateFromItems,
  messageStreamStableItems,
} from "../../../../src/features/chat/application/state/message-stream";
import {
  forkCandidatesFromItems,
  latestImplementablePlanTargetFromItems,
} from "../../../../src/features/chat/domain/message-stream/selectors";
import type { ChatPanelComposerShellState, ChatPanelMessageStreamShellState } from "../../../../src/features/chat/panel/shell-state";

export function composerShellStateFromChatState(state: ChatState): ChatPanelComposerShellState {
  return {
    connection: state.connection,
    threadList: state.threadList,
    activeThread: state.activeThread,
    runtime: state.runtime,
    composer: state.composer,
    turnBusy: chatTurnBusy(state),
    activeTurnId: activeTurnId(state),
    runtimeSnapshot: runtimeSnapshotForChatState(state),
  };
}

export function messageStreamShellStateFromChatState(state: ChatState): ChatPanelMessageStreamShellState {
  const turnBusy = chatTurnBusy(state);
  const items = messageStreamItems(state.messageStream);
  return {
    activeThread: state.activeThread,
    messageStream: state.messageStream,
    requests: state.requests,
    ui: state.ui,
    activeTurnId: activeTurnId(state),
    items,
    stableItems: messageStreamStableItems(state.messageStream),
    activeItems: messageStreamActiveItems(state.messageStream),
    rollbackCandidate: turnBusy ? null : messageStreamRollbackCandidateFromItems(items),
    forkCandidates: turnBusy ? [] : forkCandidatesFromItems(items),
    implementPlanTarget:
      !state.activeThread.id || turnBusy || state.runtime.selectedCollaborationMode !== "plan"
        ? null
        : latestImplementablePlanTargetFromItems(items),
  };
}
