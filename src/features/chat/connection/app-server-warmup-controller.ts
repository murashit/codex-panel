import type { ChatViewDeferredTasks } from "../lifecycle";

export interface AppServerWarmupControllerHost {
  deferredTasks: ChatViewDeferredTasks;
  opened: () => boolean;
  closing: () => boolean;
  connected: () => boolean;
  ensureConnected: () => Promise<void>;
}

export function scheduleAppServerWarmup(host: AppServerWarmupControllerHost): void {
  const shouldWarmup = (): boolean => host.opened() && !host.connected();

  if (!shouldWarmup()) return;

  host.deferredTasks.scheduleAppServerWarmup(() => {
    if (!shouldWarmup() || host.closing()) return;
    void host.ensureConnected();
  });
}
