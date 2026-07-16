import { awaitingResumeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

export interface RestorationControllerHost {
  stateStore: ChatStateStore;
}

export type RestoredThreadLoader = (threadId: string) => Promise<void>;

export class RestorationController {
  private loading: { threadId: string; promise: Promise<void> } | null = null;

  constructor(private readonly host: RestorationControllerHost) {}

  invalidate(): void {
    this.loading = null;
  }

  async ensureLoaded(loadThread: RestoredThreadLoader): Promise<boolean> {
    const restoredThread = awaitingResumeThreadState(this.host.stateStore.getState());
    if (!restoredThread) return true;
    if (this.loading?.threadId === restoredThread.threadId) {
      await this.loading.promise;
      return this.restorationLoaded();
    }

    const threadId = restoredThread.threadId;
    const loading = { threadId, promise: loadThread(threadId) };
    this.loading = loading;
    try {
      await loading.promise;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
    return this.restorationLoaded();
  }

  isPending(threadId: string): boolean {
    return awaitingResumeThreadState(this.host.stateStore.getState())?.threadId === threadId;
  }

  private restorationLoaded(): boolean {
    return awaitingResumeThreadState(this.host.stateStore.getState()) === null;
  }
}
