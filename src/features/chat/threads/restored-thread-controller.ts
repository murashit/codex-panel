import type { DisplayItem } from "../display/types";
import { restoreThreadPlaceholderAction } from "../chat-state-actions";
import type { ChatStateStore } from "../chat-state";
import {
  transitionRestoredThreadLifecycle,
  type RestoredThreadLifecycleState,
  type RestoredThreadPlaceholderState,
  type RestoredThreadState,
  type ChatViewDeferredTasks,
} from "../panel/lifecycle";

export interface RestoredThreadControllerHost {
  deferredTasks: ChatViewDeferredTasks;
  opened: () => boolean;
  resumeThread: (threadId: string) => Promise<void>;
  invalidateResumeWork: () => void;
  stateStore: ChatStateStore;
  systemItem: (text: string) => DisplayItem;
  setStatus: (status: string) => void;
  refreshTabHeader: () => void;
}

export class RestoredThreadController {
  private lifecycle: RestoredThreadLifecycleState = { kind: "idle" };

  constructor(private readonly host: RestoredThreadControllerHost) {}

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
    this.host.invalidateResumeWork();
    this.lifecycle = transitionRestoredThreadLifecycle(this.lifecycle, {
      type: "placeholder-restored",
      restoredThread,
    });
    this.host.stateStore.dispatch(
      restoreThreadPlaceholderAction(restoredThread.threadId, this.host.systemItem("Thread restored. Send a message to resume it.")),
    );
    this.host.setStatus("Thread ready to resume.");
    this.host.refreshTabHeader();
    this.scheduleHydration();
  }

  async ensureLoaded(): Promise<boolean> {
    const restoredThread = this.placeholder();
    if (!restoredThread) return true;
    this.clearHydration();
    if (restoredThread.loading) {
      const threadId = restoredThread.threadId;
      await restoredThread.loading;
      return !this.isPending(threadId);
    }

    const threadId = restoredThread.threadId;
    const loading = this.host.resumeThread(threadId);
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

  scheduleHydration(): void {
    const restoredThread = this.placeholder();
    if (!this.host.opened() || !restoredThread) return;
    const threadId = restoredThread.threadId;
    this.host.deferredTasks.scheduleRestoredThreadHydration(() => {
      if (!this.isPending(threadId)) return;
      void this.ensureLoaded();
    });
  }

  clearHydration(): void {
    this.host.deferredTasks.clearRestoredThreadHydration();
  }
}
