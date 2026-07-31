import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { chatTurnBusy } from "../turns/turn-state";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";
import type { PersistentNavigationLifecycle } from "./persistent-navigation-lifecycle";
import type { ChatResumeWorkTracker } from "./resume-work";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadNavigationCommandsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  closeForThreadSelection: () => void;
  openThreadFromPanel: (threadId: string, originSwitchable: boolean) => Promise<void>;
  resumeWork: ChatResumeWorkTracker;
  addSystemMessage: (text: string) => void;
  focusComposer: () => void;
  navigation: PersistentNavigationLifecycle;
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
      if (chatTurnBusy(state.activeTurn) && activeThreadState(state)?.provenance?.kind !== "subagent") return;
      const intent = host.resumeWork.begin(null);
      const preparation = await host.navigation.prepareForPersistentNavigation(null);
      if (!preparation || !host.resumeWork.isCurrent(intent)) return;

      host.identity.clearActiveThreadIdentity();
      host.navigation.commitPersistentNavigation(preparation);
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
