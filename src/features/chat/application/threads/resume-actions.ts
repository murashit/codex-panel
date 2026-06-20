import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import { resumeChatThread, type ChatThreadResumeSnapshot } from "../../app-server/threads/resume";
import { resumedThreadAction } from "../state/actions";
import { activeThreadId, canSwitchToThread, listedThreads, messageStreamItemsEmpty } from "../state/selectors";
import type { ChatStateStore } from "../state/store";
import type { RestorationController } from "./restoration-controller";
import type { HistoryController } from "./history-controller";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../lifecycle";

export interface ResumeActionsHost {
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
  resumeFromAppServer?: (client: AppServerClient, threadId: string, cwd: string) => Promise<ChatThreadResumeSnapshot>;
}

export interface ResumeActions {
  resumeThread(threadId: string): Promise<void>;
}

export function createResumeActions(host: ResumeActionsHost): ResumeActions {
  return {
    resumeThread: (threadId) => resumeThread(host, threadId),
  };
}

function finishBeforeSwitchingThreadsMessage(): string {
  return "Finish or interrupt the current turn before switching threads.";
}

function resumedThreadMessage(threadId: string): string {
  return `Resumed thread ${threadId}`;
}

async function resumeThread(host: ResumeActionsHost, threadId: string): Promise<void> {
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
    const response = await (host.resumeFromAppServer ?? resumeChatThread)(client, threadId, host.vaultPath);
    if (isStaleResume(host, resume)) return;
    applyResumedThread(host, response);
    recoverResumedThreadTokenUsage(host, response.activation.thread.id, response.rolloutPath, resume);
    if (response.initialHistoryPage) {
      host.history.applyLatestPage(response.activation.thread.id, response.initialHistoryPage);
    } else {
      await host.history.loadLatest(response.activation.thread.id);
    }
    if (isStaleResume(host, resume)) return;
    await host.syncThreadGoal(response.activation.thread.id);
    if (isStaleResume(host, resume)) return;
    const renderFallbackMessage = messageStreamItemsEmpty(host.stateStore.getState());
    if (renderFallbackMessage) {
      host.addSystemMessage(resumedThreadMessage(response.activation.thread.id));
    }
    host.refreshLiveState();
  } catch (error) {
    if (isStaleResume(host, resume)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

function applyResumedThread(host: ResumeActionsHost, response: ChatThreadResumeSnapshot): void {
  host.stateStore.dispatch(
    resumedThreadAction({
      response: response.activation,
      listedThreads: listedThreads(host.stateStore.getState()),
    }),
  );
  host.restoration.clear();
  host.clearDeferredRestoredThreadHydration();
  host.resetThreadTurnPresence(false);
  host.notifyActiveThreadIdentityChanged();
}

function recoverResumedThreadTokenUsage(host: ResumeActionsHost, threadId: string, path: string | null, resume: ActiveChatResume): void {
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

function isStaleResume(host: ResumeActionsHost, resume: ActiveChatResume): boolean {
  return host.resumeWork.isStale(resume) || host.closing();
}
