import { DeferredTask, type DeferredTaskWindow } from "../../../../shared/async/deferred-task";

export interface ChatViewDeferredTasks {
  scheduleDiagnostics(callback: () => void): void;
  clearDiagnostics(): void;
  scheduleAppServerWarmup(callback: () => void): void;
  clearAppServerWarmup(): void;
  clearAll(): void;
}

export function createChatViewDeferredTasks(getWindow: () => DeferredTaskWindow): ChatViewDeferredTasks {
  const diagnosticsTask = new DeferredTask(getWindow, 1_000);
  const appServerWarmupTask = new DeferredTask(getWindow, 0);

  return {
    scheduleDiagnostics(callback): void {
      diagnosticsTask.schedule(callback);
    },

    clearDiagnostics(): void {
      diagnosticsTask.clear();
    },

    scheduleAppServerWarmup(callback): void {
      appServerWarmupTask.schedule(callback);
    },

    clearAppServerWarmup(): void {
      appServerWarmupTask.clear();
    },

    clearAll(): void {
      appServerWarmupTask.clear();
      diagnosticsTask.clear();
    },
  };
}
