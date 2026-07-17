import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { chatTurnBusy } from "../turns/turn-state";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";
import type { PersistentNavigationLifecycle } from "./persistent-navigation-lifecycle";
import type { ActiveChatResume, ChatResumeWorkTracker } from "./resume-work";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadNavigationActionsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string, intent: ActiveChatResume) => Promise<boolean>;
  resumeWork: ChatResumeWorkTracker;
  addSystemMessage: (text: string) => void;
  focusComposer: () => void;
  navigation: PersistentNavigationLifecycle;
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
    const intent = host.resumeWork.begin(threadId);

    host.closeForThreadSelection();
    if (await host.focusThreadInOpenView(threadId)) return;
    if (!host.resumeWork.isCurrent(intent)) return;
    const preparation = await host.navigation.prepareForPersistentNavigation(threadId);
    if (!preparation || !host.resumeWork.isCurrent(intent)) return;
    if (!(await host.resumeThread(threadId, intent)) || !host.resumeWork.isCurrent(intent)) return;
    await host.navigation.completePersistentNavigation(preparation);
  };

  return {
    async startNewThread(): Promise<void> {
      const state = host.stateStore.getState();
      if (chatTurnBusy(state) && activeThreadState(state)?.provenance?.kind !== "subagent") return;
      const intent = host.resumeWork.begin(null);
      if (!(await host.navigation.prepareForPersistentNavigation(null)) || !host.resumeWork.isCurrent(intent)) return;

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
