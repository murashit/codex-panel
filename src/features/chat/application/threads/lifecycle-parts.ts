import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ChatResumeWorkTracker } from "../lifecycle";
import type { ChatStateStore } from "../state/store";
import { createActiveThreadIdentitySync } from "./active-thread-identity-sync";
import type { GoalActions } from "./goal-actions";
import type { HistoryController } from "./history-controller";
import { RestorationController } from "./restoration-controller";
import { createResumeActions, type ResumeActions } from "./resume-actions";
import type { ThreadResumeTransport } from "./thread-loading-transport";

export interface ThreadLifecyclePartsContext {
  stateStore: ChatStateStore;
  resumeTransport: ThreadResumeTransport;
  lifecycle: {
    resumeWork: ChatResumeWorkTracker;
    history: HistoryController;
    invalidateThreadWork: () => void;
    getClosing: () => boolean;
    recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
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
  const { stateStore, resumeTransport, lifecycle, thread, status, liveState, goals, resetThreadTurnPresence } = context;
  const { resumeWork, history, invalidateThreadWork } = lifecycle;
  const restoration = new RestorationController({
    invalidateThreadWork,
    setStatus: status.set,
    refreshTabHeader: thread.refreshTabHeader,
  });
  const resume = createResumeActions({
    stateStore,
    resumeWork,
    history,
    restoration,
    resumeTransport,
    closing: lifecycle.getClosing,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    refreshLiveState: liveState.refresh,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    ...(lifecycle.recoverTokenUsageFromRollout ? { recoverTokenUsageFromRollout: lifecycle.recoverTokenUsageFromRollout } : {}),
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
