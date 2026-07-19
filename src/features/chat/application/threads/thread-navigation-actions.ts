import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { chatTurnBusy } from "../turns/turn-state";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";
import type { PersistentNavigationLifecycle } from "./persistent-navigation-lifecycle";
import type { ResumeThreadOptions } from "./resume-actions";
import type { ActiveChatResume, ChatResumeWorkTracker } from "./resume-work";
import { canSwitchToThread } from "./thread-switching";

export interface ThreadNavigationActionsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  openThreadFromHistory: (threadId: string, originSwitchable: boolean) => Promise<void>;
  resumeThread: (threadId: string, intent: ActiveChatResume, options?: ResumeThreadOptions) => Promise<boolean>;
  resumeWork: ChatResumeWorkTracker;
  addSystemMessage: (text: string) => void;
  focusComposer: () => void;
  navigation: PersistentNavigationLifecycle;
}

export interface ThreadNavigationActions {
  startNewThread(options?: { focus?: boolean }): Promise<void>;
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
    if (
      !(await host.resumeThread(threadId, intent, {
        onAdopted: () => {
          host.navigation.commitPersistentNavigation(preparation);
        },
      })) ||
      !host.resumeWork.isCurrent(intent)
    )
      return;
  };

  return {
    async startNewThread(options: { focus?: boolean } = {}): Promise<void> {
      const state = host.stateStore.getState();
      if (chatTurnBusy(state) && activeThreadState(state)?.provenance?.kind !== "subagent") return;
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
      await host.openThreadFromHistory(threadId, originSwitchable);
    },
  };
}
