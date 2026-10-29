import type { ChatStateStore } from "../state/store";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadNavigationCommandsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  closeForThreadSelection: () => void;
  openThreadFromPanel: (threadId: string, originSwitchable: boolean) => Promise<void>;
  addSystemMessage: (text: string) => void;
  focusComposer: () => void;
}

export interface ThreadNavigationCommands {
  startNewThread(options?: { focus?: boolean }): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  selectThreadFromToolbar(threadId: string): Promise<void>;
}

export function createThreadNavigationCommands(host: ThreadNavigationCommandsHost): ThreadNavigationCommands {
  const selectThread = async (threadId: string): Promise<void> => {
    if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
      host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    host.closeForThreadSelection();
    host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
    await host.openThreadFromPanel(threadId, true);
  };

  return {
    async startNewThread(options: { focus?: boolean } = {}): Promise<void> {
      const state = host.stateStore.getState();
      if (!canSwitchToThread(state, null)) return;

      host.identity.clearActiveThreadIdentity();
      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      host.stateStore.dispatch({ type: "connection/status-set", statusText: "New chat." });
      if (options.focus !== false) host.focusComposer();
    },
    selectThread,
    async selectThreadFromToolbar(threadId) {
      const originSwitchable = canSwitchToThread(host.stateStore.getState(), threadId);
      host.closeForThreadSelection();
      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      await host.openThreadFromPanel(threadId, originSwitchable);
    },
  };
}
