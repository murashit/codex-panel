import {
  type RestoredThreadLifecycleState,
  type RestoredThreadPlaceholderState,
  type RestoredThreadState,
  transitionRestoredThreadLifecycle,
} from "./restored-thread-lifecycle";

const STATUS_THREAD_READY_TO_RESUME = "Thread ready to resume.";

export interface RestorationControllerHost {
  invalidateThreadWork: () => void;
  setStatus: (status: string) => void;
  refreshTabHeader: () => void;
}

export type RestoredThreadLoader = (threadId: string) => Promise<void>;

export class RestorationController {
  private lifecycle: RestoredThreadLifecycleState = { kind: "idle" };

  constructor(private readonly host: RestorationControllerHost) {}

  placeholder(): RestoredThreadPlaceholderState | null {
    return this.lifecycle.kind === "placeholder" ? this.lifecycle : null;
  }

  title(): string | null {
    return this.placeholder()?.title ?? null;
  }

  clear(): void {
    this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, { type: "cleared" });
  }

  rename(threadId: string, name: string | null): boolean {
    const previous = this.placeholder();
    this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, { type: "renamed", threadId, name });
    return this.placeholder() !== previous;
  }

  restore(restoredThread: RestoredThreadState): void {
    this.host.invalidateThreadWork();
    this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, {
      type: "placeholder-restored",
      restoredThread,
    });
    this.host.setStatus(STATUS_THREAD_READY_TO_RESUME);
    this.host.refreshTabHeader();
  }

  async ensureLoaded(loadThread: RestoredThreadLoader): Promise<boolean> {
    const restoredThread = this.placeholder();
    if (!restoredThread) return true;
    if (restoredThread.loading) {
      const threadId = restoredThread.threadId;
      await restoredThread.loading;
      return !this.isPending(threadId);
    }

    const threadId = restoredThread.threadId;
    const loading = loadThread(threadId);
    this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, { type: "loading-started", loading });
    try {
      await loading;
    } finally {
      this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, { type: "loading-finished", loading });
    }
    return !this.isPending(threadId);
  }

  isPending(threadId: string): boolean {
    return this.placeholder()?.threadId === threadId;
  }
}
