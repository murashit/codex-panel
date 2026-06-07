import type { ChatViewDeferredTasks } from "../panel/lifecycle";

export interface AppServerWarmupControllerHost {
  deferredTasks: ChatViewDeferredTasks;
  opened: () => boolean;
  closing: () => boolean;
  connected: () => boolean;
  ensureConnected: () => Promise<void>;
}

export interface AppServerWarmupActions {
  schedule(): void;
}

export function createAppServerWarmupActions(host: AppServerWarmupControllerHost): AppServerWarmupActions {
  const shouldWarmup = (): boolean => host.opened() && !host.connected();
  return {
    schedule() {
      if (!shouldWarmup()) return;

      host.deferredTasks.scheduleAppServerWarmup(() => {
        if (!shouldWarmup() || host.closing()) return;
        void host.ensureConnected();
      });
    },
  };
}
