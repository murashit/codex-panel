import { chatTurnBusy } from "../conversation/turn-state";
import type { ChatStateStore } from "../state/store";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadNavigationActionsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
  focusComposer: () => void;
}

export interface ThreadNavigationActions {
  startNewThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  selectThreadFromToolbar(threadId: string): Promise<void>;
}

export function createThreadNavigationActions(host: ThreadNavigationActionsHost): ThreadNavigationActions {
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
    async startNewThread(): Promise<void> {
      if (chatTurnBusy(host.stateStore.getState())) return;

      host.identity.clearActiveThreadIdentity();
      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      host.stateStore.dispatch({ type: "connection/status-set", statusText: "New chat." });
      host.focusComposer();
    },
    selectThread,
    async selectThreadFromToolbar(threadId) {
      if (!canSwitchToThread(host.stateStore.getState(), threadId)) return;

      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      await selectThread(threadId);
    },
  };
}
