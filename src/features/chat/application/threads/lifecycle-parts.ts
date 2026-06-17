import type { AppServerClient } from "../../../../app-server/connection/client";
import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import type { GoalActions } from "./goal-actions";
import type { HistoryController } from "./history-controller";
import { createIdentitySync } from "./identity-sync";
import { createResumeController, type ResumeController } from "./resume-controller";
import { RestorationController } from "./restoration-controller";

export interface ThreadLifecyclePartsContext {
  settingsRef: { readonly vaultPath: string };
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    resumeWork: ChatResumeWorkTracker;
    history: HistoryController;
    invalidateThreadWork: () => void;
    getOpened: () => boolean;
    getClosing: () => boolean;
  };
  thread: {
    notifyIdentityChanged: () => void;
    refreshTabHeader: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  liveState: {
    refresh: () => void;
  };
  goals: GoalActions;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
}

export interface ThreadLifecycleParts {
  history: HistoryController;
  restoration: RestorationController;
  resume: ResumeController;
  identity: ReturnType<typeof createIdentitySync>;
}

export function createThreadLifecycleParts(context: ThreadLifecyclePartsContext): ThreadLifecycleParts {
  const { settingsRef, stateStore, client, lifecycle, thread, status, liveState, goals, resetThreadTurnPresence } = context;
  const { deferredTasks, resumeWork, history, invalidateThreadWork } = lifecycle;
  const restoration = new RestorationController({
    deferredTasks,
    opened: lifecycle.getOpened,
    invalidateThreadWork,
    stateStore,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const resume = createResumeController({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    resumeWork,
    history,
    restoration,
    currentClient: client.currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    resetThreadTurnPresence,
    clearDeferredRestoredThreadHydration: () => {
      restoration.clearHydration();
    },
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    refreshLiveState: liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, async (filePath, options) => {
        const response = await client.currentClient()?.readFile(filePath, options);
        return response?.dataBase64 ?? "";
      }),
  });
  const identity = createIdentitySync({
    stateStore,
    restoration,
    invalidateThreadWork,
    clearDeferredRestoredThreadHydration: () => {
      restoration.clearHydration();
    },
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
    refreshLiveState: liveState.refresh,
  });

  return {
    history,
    restoration,
    resume,
    identity,
  };
}
