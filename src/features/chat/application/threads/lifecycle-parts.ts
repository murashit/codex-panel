import type { AppServerClient } from "../../../../app-server/connection/client";
import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import type { ChatResumeWorkTracker } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import type { GoalActions } from "./goal-actions";
import type { HistoryController } from "./history-controller";
import { createActiveThreadIdentitySync } from "./active-thread-identity-sync";
import { createResumeActions, type ResumeActions } from "./resume-actions";
import { RestorationController } from "./restoration-controller";

export interface ThreadLifecyclePartsContext {
  settingsRef: { readonly vaultPath: string };
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    resumeWork: ChatResumeWorkTracker;
    history: HistoryController;
    invalidateThreadWork: () => void;
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
  resume: ResumeActions;
  identity: ReturnType<typeof createActiveThreadIdentitySync>;
}

export function createThreadLifecycleParts(context: ThreadLifecyclePartsContext): ThreadLifecycleParts {
  const { settingsRef, stateStore, client, lifecycle, thread, status, liveState, goals, resetThreadTurnPresence } = context;
  const { resumeWork, history, invalidateThreadWork } = lifecycle;
  const restoration = new RestorationController({
    invalidateThreadWork,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const resume = createResumeActions({
    stateStore,
    vaultPath: settingsRef.vaultPath,
    resumeWork,
    history,
    restoration,
    currentClient: client.currentClient,
    ensureConnected: client.ensureConnected,
    closing: lifecycle.getClosing,
    resetThreadTurnPresence,
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
  const identity = createActiveThreadIdentitySync({
    stateStore,
    restoration,
    invalidateThreadWork,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    refreshTabHeader: thread.refreshTabHeader,
  });

  return {
    history,
    restoration,
    resume,
    identity,
  };
}
