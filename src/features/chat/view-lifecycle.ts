export interface ChatViewRenderScheduleOptions {
  forceSlots?: boolean;
}

export interface RestoredThreadState {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export type ChatResumeLifecycleState = { kind: "idle" } | { kind: "resuming"; threadId: string };
export type ActiveChatResume = Extract<ChatResumeLifecycleState, { kind: "resuming" }>;
export type ChatResumeLifecycleEvent = { type: "started"; resume: ActiveChatResume } | { type: "invalidated" };

export type ChatConnectionLifecycleState = { kind: "idle" } | { kind: "connecting"; promise: Promise<void> | null };
export type ActiveChatConnection = Extract<ChatConnectionLifecycleState, { kind: "connecting" }>;
export type ChatConnectionLifecycleEvent =
  | { type: "started"; connection: ActiveChatConnection }
  | { type: "finished"; connection: ActiveChatConnection; promise: Promise<void> }
  | { type: "invalidated" };

export type RestoredThreadLifecycleState =
  | { kind: "idle" }
  | { kind: "placeholder"; threadId: string; title: string | null; explicitName: string | null; loading: Promise<void> | null };
export type RestoredThreadPlaceholderState = Extract<RestoredThreadLifecycleState, { kind: "placeholder" }>;
export type RestoredThreadLifecycleEvent =
  | { type: "placeholder-restored"; restoredThread: RestoredThreadState }
  | { type: "renamed"; threadId: string; name: string | null }
  | { type: "loading-started"; loading: Promise<void> }
  | { type: "loading-finished"; loading: Promise<void> }
  | { type: "cleared" };

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

export class ChatConnectionWorkTracker {
  private state: ChatConnectionLifecycleState = { kind: "idle" };

  active(): ActiveChatConnection | null {
    return this.state.kind === "connecting" ? this.state : null;
  }

  begin(): ActiveChatConnection {
    const connection: ActiveChatConnection = { kind: "connecting", promise: null };
    this.state = transitionChatConnectionLifecycle(this.state, { type: "started", connection });
    return connection;
  }

  finish(connection: ActiveChatConnection, promise: Promise<void>): void {
    this.state = transitionChatConnectionLifecycle(this.state, { type: "finished", connection, promise });
  }

  invalidate(): void {
    this.state = transitionChatConnectionLifecycle(this.state, { type: "invalidated" });
  }

  isStale(connection: ActiveChatConnection): boolean {
    return this.state !== connection;
  }
}

export class ChatResumeWorkTracker {
  private state: ChatResumeLifecycleState = { kind: "idle" };

  constructor(private readonly onInvalidate: () => void) {}

  begin(threadId: string): ActiveChatResume {
    const resume: ActiveChatResume = { kind: "resuming", threadId };
    this.state = transitionChatResumeLifecycle(this.state, { type: "started", resume });
    this.onInvalidate();
    return resume;
  }

  invalidate(): void {
    this.state = transitionChatResumeLifecycle(this.state, { type: "invalidated" });
    this.onInvalidate();
  }

  isStale(resume: ActiveChatResume): boolean {
    return this.state !== resume;
  }
}

export function transitionChatConnectionLifecycle(
  state: ChatConnectionLifecycleState,
  event: ChatConnectionLifecycleEvent,
): ChatConnectionLifecycleState {
  switch (event.type) {
    case "started":
      return event.connection;
    case "finished":
      return state === event.connection && state.promise === event.promise ? { kind: "idle" } : state;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}

export function transitionChatResumeLifecycle(state: ChatResumeLifecycleState, event: ChatResumeLifecycleEvent): ChatResumeLifecycleState {
  switch (event.type) {
    case "started":
      return event.resume;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}

export function transitionRestoredThreadLifecycle(
  state: RestoredThreadLifecycleState,
  event: RestoredThreadLifecycleEvent,
): RestoredThreadLifecycleState {
  switch (event.type) {
    case "placeholder-restored":
      return { kind: "placeholder", ...event.restoredThread, loading: null };
    case "renamed":
      if (state.kind !== "placeholder" || state.threadId !== event.threadId) return state;
      return { ...state, title: event.name, explicitName: event.name };
    case "loading-started":
      if (state.kind !== "placeholder") return state;
      return { ...state, loading: event.loading };
    case "loading-finished":
      if (state.kind !== "placeholder" || state.loading !== event.loading) return state;
      return { ...state, loading: null };
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
