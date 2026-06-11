import type { AppServerClient } from "../../../app-server/client";
import type { ThreadTokenUsage } from "../../../app-server/runtime-metrics";
import { setActiveThreadTokenUsageAction } from "../state/actions";
import { activeThreadId, canSwitchToThread, displayItemsEmpty, listedThreads } from "../state/selectors";
import type { ChatStateStore } from "../state/reducer";
import type { RestoredThreadController } from "./restored-thread-controller";
import { resumedThreadActionFromAppServerResponse } from "./thread-resume";
import type { ThreadHistoryController } from "./thread-history-controller";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../panel/lifecycle";

export interface ThreadResumeControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  resumeWork: ChatResumeWorkTracker;
  history: ThreadHistoryController;
  restoredThread: RestoredThreadController;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  closing: () => boolean;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  clearDeferredRestoredThreadHydration: () => void;
  notifyActiveThreadIdentityChanged: () => void;
  addSystemMessage: (text: string) => void;
  render: () => void;
  refreshLiveState: () => void;
  syncThreadGoal: (threadId: string) => Promise<void>;
  recoverTokenUsageFromRollout?: (path: string) => Promise<ThreadTokenUsage | null>;
}

export class ThreadResumeController {
  constructor(private readonly host: ThreadResumeControllerHost) {}

  async resumeThread(threadId: string): Promise<void> {
    if (!canSwitchToThread(this.host.stateStore.getState(), threadId)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }
    const resume = this.host.resumeWork.begin(threadId);
    this.host.history.invalidate();
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client || this.isStale(resume)) return;

    try {
      const response = await client.resumeThread(threadId, this.host.vaultPath);
      if (this.isStale(resume)) return;
      this.applyResumedThread(response);
      this.recoverResumedThreadTokenUsage(response.thread.id, response.thread.path, resume);
      if (response.initialTurnsPage) {
        this.host.history.applyLatestPage(response.thread.id, response.initialTurnsPage);
      } else {
        await this.host.history.loadLatest(response.thread.id);
      }
      if (this.isStale(resume)) return;
      await this.host.syncThreadGoal(response.thread.id);
      if (this.isStale(resume)) return;
      const renderFallbackMessage = displayItemsEmpty(this.host.stateStore.getState());
      if (renderFallbackMessage) {
        this.host.addSystemMessage(`Resumed thread ${response.thread.id}`);
      }
      this.host.render();
      this.host.refreshLiveState();
    } catch (error) {
      if (this.isStale(resume)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private applyResumedThread(response: Awaited<ReturnType<AppServerClient["resumeThread"]>>): void {
    this.host.stateStore.dispatch(
      resumedThreadActionFromAppServerResponse({
        response,
        listedThreads: listedThreads(this.host.stateStore.getState()),
      }),
    );
    this.host.restoredThread.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.render();
    this.host.refreshLiveState();
  }

  private recoverResumedThreadTokenUsage(threadId: string, path: string | null, resume: ActiveChatResume): void {
    if (!path || !this.host.recoverTokenUsageFromRollout) return;
    void this.host
      .recoverTokenUsageFromRollout(path)
      .then((tokenUsage) => {
        if (!tokenUsage || this.isStale(resume)) return;
        const state = this.host.stateStore.getState();
        if (activeThreadId(state) !== threadId || state.activeThread.tokenUsage !== null) return;
        this.host.stateStore.dispatch(setActiveThreadTokenUsageAction(tokenUsage));
        this.host.refreshLiveState();
        this.host.render();
      })
      .catch(() => undefined);
  }

  private isStale(resume: ActiveChatResume): boolean {
    return this.host.resumeWork.isStale(resume) || this.host.closing();
  }
}
