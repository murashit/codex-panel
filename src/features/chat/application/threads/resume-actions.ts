import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import { type ChatThreadResumeClient, type ChatThreadResumeSnapshot, resumeChatThread } from "../../app-server/threads/projection";
import type { ActiveChatResume, ChatResumeWorkTracker } from "../lifecycle";
import { resumedThreadAction } from "../state/actions";
import { messageStreamIsEmpty } from "../state/message-stream";
import type { ChatStateStore } from "../state/store";
import type { HistoryController } from "./history-controller";
import type { RestorationController } from "./restoration-controller";
import { canSwitchToThread } from "./thread-switching";

export interface ResumeActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  resumeWork: ChatResumeWorkTracker;
  history: HistoryController;
  restoration: RestorationController;
  currentClient: () => ChatThreadResumeClient | null;
  ensureConnected: () => Promise<void>;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  notifyActiveThreadIdentityChanged: () => void;
  addSystemMessage: (text: string) => void;
  refreshLiveState: () => void;
  syncThreadGoal: (threadId: string) => Promise<void>;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
  resumeFromAppServer?: (client: ChatThreadResumeClient, threadId: string, cwd: string) => Promise<ChatThreadResumeSnapshot>;
}

export interface ResumeActions {
  resumeThread(threadId: string): Promise<void>;
}

export function createResumeActions(host: ResumeActionsHost): ResumeActions {
  return {
    resumeThread: (threadId) => resumeThread(host, threadId),
  };
}

async function resumeThread(host: ResumeActionsHost, threadId: string): Promise<void> {
  if (!canSwitchToThread(host.stateStore.getState(), threadId)) {
    host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
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
    const renderFallbackMessage = messageStreamIsEmpty(host.stateStore.getState().messageStream);
    if (renderFallbackMessage) {
      host.addSystemMessage(`Resumed thread ${response.activation.thread.id}`);
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
      listedThreads: host.stateStore.getState().threadList.listedThreads,
    }),
  );
  host.restoration.clear();
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
      if (state.activeThread.id !== threadId || state.activeThread.tokenUsage !== null) return;
      host.stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
      host.refreshLiveState();
    })
    .catch(() => undefined);
}

function isStaleResume(host: ResumeActionsHost, resume: ActiveChatResume): boolean {
  return host.resumeWork.isStale(resume) || host.closing();
}
