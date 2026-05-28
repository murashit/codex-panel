type TimerWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export type ThreadsViewRefreshLifecycleState = { kind: "idle" } | { kind: "loading" };
export type ActiveThreadsViewRefresh = Extract<ThreadsViewRefreshLifecycleState, { kind: "loading" }>;
export type ThreadsViewRefreshLifecycleEvent =
  | { type: "started"; refresh: ActiveThreadsViewRefresh }
  | { type: "finished"; refresh: ActiveThreadsViewRefresh }
  | { type: "invalidated" };

export type ThreadsViewConnectionLifecycleState = { kind: "idle" } | { kind: "connecting"; promise: Promise<void> | null };
export type ActiveThreadsViewConnection = Extract<ThreadsViewConnectionLifecycleState, { kind: "connecting" }>;
export type ThreadsViewConnectionLifecycleEvent =
  | { type: "started"; connection: ActiveThreadsViewConnection }
  | { type: "finished"; connection: ActiveThreadsViewConnection; promise: Promise<void> }
  | { type: "invalidated" };

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

export function transitionThreadsViewRefreshLifecycle(
  state: ThreadsViewRefreshLifecycleState,
  event: ThreadsViewRefreshLifecycleEvent,
): ThreadsViewRefreshLifecycleState {
  switch (event.type) {
    case "started":
      return event.refresh;
    case "finished":
      return state === event.refresh ? { kind: "idle" } : state;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}

export function transitionThreadsViewConnectionLifecycle(
  state: ThreadsViewConnectionLifecycleState,
  event: ThreadsViewConnectionLifecycleEvent,
): ThreadsViewConnectionLifecycleState {
  switch (event.type) {
    case "started":
      return event.connection;
    case "finished":
      return state === event.connection && state.promise === event.promise ? { kind: "idle" } : state;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
