import { DeferredTask, type DeferredTaskWindow } from "../../../shared/lifecycle/deferred-task";
import type { ChatViewDeferredTasks } from "../application/lifecycle";

export function createChatViewDeferredTasks(getWindow: () => DeferredTaskWindow): ChatViewDeferredTasks {
  const diagnosticsTask = new DeferredTask(getWindow, 1_000);
  const restoredThreadHydrationTask = new DeferredTask(getWindow, 1_500);
  const appServerWarmupTask = new DeferredTask(getWindow, 0);

  return {
    scheduleDiagnostics(callback): void {
      diagnosticsTask.schedule(callback);
    },

    clearDiagnostics(): void {
      diagnosticsTask.clear();
    },

    scheduleRestoredThreadHydration(callback): void {
      restoredThreadHydrationTask.schedule(callback);
    },

    clearRestoredThreadHydration(): void {
      restoredThreadHydrationTask.clear();
    },

    scheduleAppServerWarmup(callback): void {
      appServerWarmupTask.schedule(callback);
    },

    clearAppServerWarmup(): void {
      appServerWarmupTask.clear();
    },

    clearAll(): void {
      restoredThreadHydrationTask.clear();
      appServerWarmupTask.clear();
      diagnosticsTask.clear();
    },
  };
}
