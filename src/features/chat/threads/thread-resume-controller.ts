import type { AppServerClient } from "../../../app-server/client";
import type { ThreadTokenUsage } from "../../../generated/app-server/v2/ThreadTokenUsage";
import { setActiveThreadTokenUsageAction } from "../chat-state-actions";
import { activeThreadId, canSwitchToThread, displayItemsEmpty, listedThreads } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";
import type { DisplayItem } from "../display/types";
import type { RestoredThreadController } from "./restored-thread-controller";
import { resumedThreadAction, type ThreadActivationResponse } from "./thread-resume";
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
  systemItem: (text: string) => DisplayItem;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  clearDeferredRestoredThreadHydration: () => void;
  notifyActiveThreadIdentityChanged: () => void;
  addSystemMessage: (text: string) => void;
  forceMessagesToBottom: () => void;
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
      if (displayItemsEmpty(this.host.stateStore.getState())) {
        this.host.addSystemMessage(`Resumed thread ${response.thread.id}`);
        this.host.forceMessagesToBottom();
        this.host.render();
      }
      this.host.refreshLiveState();
    } catch (error) {
      if (this.isStale(resume)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }

  private applyResumedThread(response: ThreadActivationResponse): void {
    this.host.stateStore.dispatch(
      resumedThreadAction({
        response,
        listedThreads: listedThreads(this.host.stateStore.getState()),
        displayItems: [this.host.systemItem("Loading thread...")],
      }),
    );
    this.host.restoredThread.clear();
    this.host.clearDeferredRestoredThreadHydration();
    this.host.resetThreadTurnPresence(false);
    this.host.notifyActiveThreadIdentityChanged();
    this.host.forceMessagesToBottom();
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
