import type { ChatStateStore } from "../state/store";
import { canSwitchToThread } from "./thread-switching";

export interface SelectionActionsHost {
  stateStore: ChatStateStore;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export interface SelectionActions {
  selectThread(threadId: string): Promise<void>;
  selectThreadFromToolbar(threadId: string): Promise<void>;
}

function finishBeforeSwitchingThreadsMessage(): string {
  return "Finish or interrupt the current turn before switching threads.";
}

export function createSelectionActions(host: SelectionActionsHost): SelectionActions {
  const selectThread = async (threadId: string): Promise<void> => {
    if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
      host.addSystemMessage(finishBeforeSwitchingThreadsMessage());
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
