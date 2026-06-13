import type { AppServerClient } from "../../../app-server/connection/client";
import type { ThreadTokenUsage } from "../../../domain/runtime/metrics";
import { activeThreadId, canSwitchToThread, displayItemsEmpty, listedThreads } from "../state/selectors";
import type { ChatStateStore } from "../state/reducer";
import type { RestorationController } from "./restoration-controller";
import { resumedThreadActionFromAppServerResponse } from "./resume";
import type { HistoryController } from "./history-controller";
import type { ChatResumeWorkTracker, ActiveChatResume } from "../lifecycle";

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

export class ResumeController {
  constructor(private readonly host: ResumeControllerHost) {}

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
    this.host.restoration.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
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
        this.host.stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
        this.host.refreshLiveState();
      })
      .catch(() => undefined);
  }

  private isStale(resume: ActiveChatResume): boolean {
    return this.host.resumeWork.isStale(resume) || this.host.closing();
  }
}
