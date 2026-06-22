import { runtimeSnapshotForChatState } from "../../../../src/features/chat/application/runtime/snapshot";
import { activeTurnId, chatTurnBusy, type ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import type { ChatPanelComposerShellState } from "../../../../src/features/chat/panel/shell-state";

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
