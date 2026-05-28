import type { ChatViewDeferredTasks } from "../../view-lifecycle";

export interface AppServerWarmupControllerHost {
  deferredTasks: ChatViewDeferredTasks;
  opened: () => boolean;
  closing: () => boolean;
  connected: () => boolean;
  ensureConnected: () => Promise<void>;
}

export class AppServerWarmupController {
  constructor(private readonly host: AppServerWarmupControllerHost) {}

  schedule(): void {
    if (!this.shouldWarmup()) return;

    this.host.deferredTasks.scheduleAppServerWarmup(() => {
      if (!this.shouldWarmup() || this.host.closing()) return;
      void this.host.ensureConnected();
    });
  }

  private shouldWarmup(): boolean {
    return this.host.opened() && !this.host.connected();
  }
}
