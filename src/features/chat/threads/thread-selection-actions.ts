import { canSwitchToThread } from "../state/selectors";
import type { ChatStateStore } from "../state/reducer";

export interface ThreadSelectionActionsHost {
  stateStore: ChatStateStore;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export interface ThreadSelectionActions {
  selectThread(threadId: string): Promise<void>;
  selectThreadFromToolbar(threadId: string): Promise<void>;
}

export function createThreadSelectionActions(host: ThreadSelectionActionsHost): ThreadSelectionActions {
  const selectThread = async (threadId: string): Promise<void> => {
    if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
      host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }

    host.closeForThreadSelection();
    if (await host.focusThreadInOpenView(threadId)) return;
    await host.resumeThread(threadId);
  };

  return {
    selectThread,
    async selectThreadFromToolbar(threadId) {
      if (!canSwitchToThread(host.stateStore.getState(), threadId)) return;

      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      await selectThread(threadId);
    },
  };
}
