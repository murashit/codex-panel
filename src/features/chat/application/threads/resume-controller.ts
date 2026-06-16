import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import { activeThreadId, canSwitchToThread, listedThreads, messageStreamItemsEmpty } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import type { RestorationController } from "./restoration-controller";
import { resumedThreadActionFromAppServerResponse } from "./resume";
import type { HistoryController } from "./history-controller";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../lifecycle";
import { finishBeforeSwitchingThreadsMessage, resumedThreadMessage } from "./messages";

export interface ResumeControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  resumeWork: ChatResumeWorkTracker;
  history: HistoryController;
  restoration: RestorationController;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  clearDeferredRestoredThreadHydration: () => void;
  notifyActiveThreadIdentityChanged: () => void;
  addSystemMessage: (text: string) => void;
  refreshLiveState: () => void;
  syncThreadGoal: (threadId: string) => Promise<void>;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export interface ResumeController {
  resumeThread(threadId: string): Promise<void>;
}

export function createResumeController(host: ResumeControllerHost): ResumeController {
  return {
    resumeThread: (threadId) => resumeThread(host, threadId),
  };
}

async function resumeThread(host: ResumeControllerHost, threadId: string): Promise<void> {
  if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
    host.addSystemMessage(finishBeforeSwitchingThreadsMessage());
    return;
  }
  const resume = host.resumeWork.begin(threadId);
  host.history.invalidate();
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client || isStaleResume(host, resume)) return;

  try {
    const response = await client.resumeThread(threadId, host.vaultPath);
    if (isStaleResume(host, resume)) return;
    applyResumedThread(host, response);
    recoverResumedThreadTokenUsage(host, response.thread.id, response.thread.path, resume);
    if (response.initialTurnsPage) {
      host.history.applyLatestPage(response.thread.id, response.initialTurnsPage);
    } else {
      await host.history.loadLatest(response.thread.id);
    }
    if (isStaleResume(host, resume)) return;
    await host.syncThreadGoal(response.thread.id);
    if (isStaleResume(host, resume)) return;
    const renderFallbackMessage = messageStreamItemsEmpty(host.stateStore.getState());
    if (renderFallbackMessage) {
      host.addSystemMessage(resumedThreadMessage(response.thread.id));
    }
    host.refreshLiveState();
  } catch (error) {
    if (isStaleResume(host, resume)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

function applyResumedThread(host: ResumeControllerHost, response: Awaited<ReturnType<AppServerClient["resumeThread"]>>): void {
  host.stateStore.dispatch(
    resumedThreadActionFromAppServerResponse({
      response,
      listedThreads: listedThreads(host.stateStore.getState()),
    }),
  );
  host.restoration.clear();
  host.clearDeferredRestoredThreadHydration();
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
  host.refreshLiveState();
}

function recoverResumedThreadTokenUsage(host: ResumeControllerHost, threadId: string, path: string | null, resume: ActiveChatResume): void {
  if (!path || !host.recoverTokenUsageFromRollout) return;
  void host
    .recoverTokenUsageFromRollout(path)
    .then((tokenUsage) => {
      if (!tokenUsage || isStaleResume(host, resume)) return;
      const state = host.stateStore.getState();
      if (activeThreadId(state) !== threadId || state.activeThread.tokenUsage !== null) return;
      host.stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
      host.refreshLiveState();
    })
    .catch(() => undefined);
}

function isStaleResume(host: ResumeControllerHost, resume: ActiveChatResume): boolean {
  return host.resumeWork.isStale(resume) || host.closing();
}
