export interface ChatViewRenderScheduleOptions {
  forceSlots?: boolean;
}

type TimerWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export class ChatViewDeferredTasks {
  private restoredThreadHydrationTimer: number | null = null;
  private renderTimer: number | null = null;
  private renderForceSlots = false;
  private diagnosticsTimer: number | null = null;
  private appServerWarmupTimer: number | null = null;

  constructor(private readonly getWindow: () => TimerWindow) {}

  scheduleRender(callback: (options: ChatViewRenderScheduleOptions) => void, options: ChatViewRenderScheduleOptions = {}): void {
    this.renderForceSlots ||= options.forceSlots ?? false;
    if (this.renderTimer !== null) return;
    this.renderTimer = this.getWindow().setTimeout(() => {
      const forceSlots = this.renderForceSlots;
      this.renderTimer = null;
      this.renderForceSlots = false;
      callback({ forceSlots });
    }, 50);
  }

  clearRender(): void {
    if (this.renderTimer === null) return;
    this.getWindow().clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.renderForceSlots = false;
  }

  scheduleDiagnostics(callback: () => void): void {
    if (this.diagnosticsTimer !== null) return;
    this.diagnosticsTimer = this.getWindow().setTimeout(() => {
      this.diagnosticsTimer = null;
      callback();
    }, 1_000);
  }

  clearDiagnostics(): void {
    if (this.diagnosticsTimer === null) return;
    this.getWindow().clearTimeout(this.diagnosticsTimer);
    this.diagnosticsTimer = null;
  }

  scheduleRestoredThreadHydration(callback: () => void): void {
    if (this.restoredThreadHydrationTimer !== null) return;
    this.restoredThreadHydrationTimer = this.getWindow().setTimeout(() => {
      this.restoredThreadHydrationTimer = null;
      callback();
    }, 1_500);
  }

  clearRestoredThreadHydration(): void {
    if (this.restoredThreadHydrationTimer === null) return;
    this.getWindow().clearTimeout(this.restoredThreadHydrationTimer);
    this.restoredThreadHydrationTimer = null;
  }

  scheduleAppServerWarmup(callback: () => void): void {
    if (this.appServerWarmupTimer !== null) return;
    this.appServerWarmupTimer = this.getWindow().setTimeout(() => {
      this.appServerWarmupTimer = null;
      callback();
    }, 0);
  }

  clearAppServerWarmup(): void {
    if (this.appServerWarmupTimer === null) return;
    this.getWindow().clearTimeout(this.appServerWarmupTimer);
    this.appServerWarmupTimer = null;
  }

  clearAll(): void {
    this.clearRestoredThreadHydration();
    this.clearAppServerWarmup();
    this.clearDiagnostics();
    this.clearRender();
  }
}
