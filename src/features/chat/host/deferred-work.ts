import { DeferredTask, type DeferredTaskWindow } from "../../../shared/lifecycle/deferred-task";

export interface ChatViewDeferredTasks {
  scheduleAppServerWarmup(callback: () => void): void;
  clearAppServerWarmup(): void;
  clearAll(): void;
}

export function createChatViewDeferredTasks(getWindow: () => DeferredTaskWindow): ChatViewDeferredTasks {
  const appServerWarmupTask = new DeferredTask(getWindow, 0);

  return {
    scheduleAppServerWarmup(callback): void {
      appServerWarmupTask.schedule(callback);
    },

    clearAppServerWarmup(): void {
      appServerWarmupTask.clear();
    },

    clearAll(): void {
      appServerWarmupTask.clear();
    },
  };
}
