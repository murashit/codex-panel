type TimerWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export class ThreadsViewDeferredTasks {
  private renderTimer: ReturnType<TimerWindow["setTimeout"]> | null = null;
  private refreshTimer: ReturnType<TimerWindow["setTimeout"]> | null = null;

  constructor(private readonly getWindow: () => TimerWindow) {}

  scheduleRender(callback: () => void): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = this.getWindow().setTimeout(() => {
      this.renderTimer = null;
      callback();
    }, 0);
  }

  scheduleRefresh(callback: () => void): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = this.getWindow().setTimeout(() => {
      this.refreshTimer = null;
      callback();
    }, 250);
  }

  clearAll(): void {
    this.clearRender();
    this.clearRefresh();
  }

  private clearRender(): void {
    if (this.renderTimer === null) return;
    this.getWindow().clearTimeout(this.renderTimer);
    this.renderTimer = null;
  }

  private clearRefresh(): void {
    if (this.refreshTimer === null) return;
    this.getWindow().clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
