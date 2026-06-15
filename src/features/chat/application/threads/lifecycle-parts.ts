import type { AppServerClient } from "../../../../app-server/connection/client";
import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import type { ChatResumeWorkTracker, ChatViewDeferredTasks } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import type { PluginSettingsRef } from "../ports/chat-host";
import type { GoalActions } from "./goal-actions";
import { HistoryController } from "./history-controller";
import { createIdentitySync } from "./identity-sync";
import { ResumeController } from "./resume-controller";
import { RestorationController } from "./restoration-controller";

export interface ThreadLifecyclePartsContext {
  settingsRef: PluginSettingsRef;
  stateStore: ChatStateStore;
  client: {
    currentClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    resumeWork: ChatResumeWorkTracker;
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
  scroll: {
    preservePosition: () => void;
    forceBottom: () => void;
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
  const { settingsRef, stateStore, client, lifecycle, thread, status, liveState, scroll, goals, resetThreadTurnPresence } = context;
  const { deferredTasks, resumeWork } = lifecycle;
  const history = new HistoryController({
    stateStore,
    currentClient: client.currentClient,
    addSystemMessage: status.addSystemMessage,
    keepCurrentScrollPosition: scroll.preservePosition,
    showLatestPageAtBottom: scroll.forceBottom,
    setThreadTurnPresence: resetThreadTurnPresence,
  });
  const invalidateResumeWork = () => {
    resumeWork.invalidate();
    history.invalidate();
  };
  const restoration = new RestorationController({
    deferredTasks,
    opened: lifecycle.getOpened,
    invalidateResumeWork,
    stateStore,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const resume = new ResumeController({
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
    invalidateResumeWork,
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
