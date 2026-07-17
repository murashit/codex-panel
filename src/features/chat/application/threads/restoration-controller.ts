import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent, panelTargetLeasesMatch } from "../state/panel-target";
import { activeThreadId, awaitingResumeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

export interface RestorationControllerHost {
  stateStore: ChatStateStore;
}

export type RestoredThreadLoader = (threadId: string) => Promise<void>;

export class RestorationController {
  private loading: { threadId: string; panelTarget: PanelTargetLease; promise: Promise<void> } | null = null;

  constructor(private readonly host: RestorationControllerHost) {}

  invalidate(): void {
    this.loading = null;
  }

  async ensureLoaded(loadThread: RestoredThreadLoader): Promise<boolean> {
    const restoredThread = awaitingResumeThreadState(this.host.stateStore.getState());
    if (!restoredThread) return true;
    const panelTarget = capturePanelTargetLease(this.host.stateStore.getState());
    const activeLoading = this.loading;
    if (activeLoading?.threadId === restoredThread.threadId && panelTargetLeasesMatch(activeLoading.panelTarget, panelTarget)) {
      await activeLoading.promise;
      return this.restorationLoaded(activeLoading.panelTarget, restoredThread.threadId);
    }

    const threadId = restoredThread.threadId;
    const loading = { threadId, panelTarget, promise: loadThread(threadId) };
    this.loading = loading;
    try {
      await loading.promise;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
    return this.restorationLoaded(loading.panelTarget, threadId);
  }

  isPending(threadId: string): boolean {
    return awaitingResumeThreadState(this.host.stateStore.getState())?.threadId === threadId;
  }

  private restorationLoaded(panelTarget: PanelTargetLease, threadId: string): boolean {
    const state = this.host.stateStore.getState();
    return panelTargetLeaseIsCurrent(state, panelTarget) && activeThreadId(state) === threadId;
  }
}
