import {
  transitionConnectionWorkLifecycle,
  type ActiveConnectionWork,
  type ConnectionWorkLifecycleEvent,
  type ConnectionWorkLifecycleState,
} from "../../../shared/lifecycle/connection-work";
import { DeferredTask, type DeferredTaskWindow } from "../../../shared/lifecycle/deferred-task";

export interface RestoredThreadState {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export type ChatResumeLifecycleState = { kind: "idle" } | { kind: "resuming"; threadId: string };
export type ActiveChatResume = Extract<ChatResumeLifecycleState, { kind: "resuming" }>;
export type ChatResumeLifecycleEvent = { type: "started"; resume: ActiveChatResume } | { type: "invalidated" };

export type ChatConnectionLifecycleState = ConnectionWorkLifecycleState;
export type ActiveChatConnection = ActiveConnectionWork;
export type ChatConnectionLifecycleEvent = ConnectionWorkLifecycleEvent;

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

export class ChatViewDeferredTasks {
  private readonly restoredThreadHydrationTask: DeferredTask;
  private readonly renderTask: DeferredTask;
  private readonly diagnosticsTask: DeferredTask;
  private readonly appServerWarmupTask: DeferredTask;

  constructor(getWindow: () => DeferredTaskWindow) {
    this.renderTask = new DeferredTask(getWindow, 50);
    this.diagnosticsTask = new DeferredTask(getWindow, 1_000);
    this.restoredThreadHydrationTask = new DeferredTask(getWindow, 1_500);
    this.appServerWarmupTask = new DeferredTask(getWindow, 0);
  }

  scheduleRender(callback: () => void): void {
    this.renderTask.schedule(() => {
      callback();
    });
  }

  clearRender(): void {
    this.renderTask.clear();
  }

  scheduleDiagnostics(callback: () => void): void {
    this.diagnosticsTask.schedule(callback);
  }

  clearDiagnostics(): void {
    this.diagnosticsTask.clear();
  }

  scheduleRestoredThreadHydration(callback: () => void): void {
    this.restoredThreadHydrationTask.schedule(callback);
  }

  clearRestoredThreadHydration(): void {
    this.restoredThreadHydrationTask.clear();
  }

  scheduleAppServerWarmup(callback: () => void): void {
    this.appServerWarmupTask.schedule(callback);
  }

  clearAppServerWarmup(): void {
    this.appServerWarmupTask.clear();
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

  begin(threadId: string): ActiveChatResume {
    const resume: ActiveChatResume = { kind: "resuming", threadId };
    this.state = transitionChatResumeLifecycle(this.state, { type: "started", resume });
    return resume;
  }

  invalidate(): void {
    this.state = transitionChatResumeLifecycle(this.state, { type: "invalidated" });
  }

  isStale(resume: ActiveChatResume): boolean {
    return this.state !== resume;
  }
}

export function transitionChatConnectionLifecycle(
  state: ChatConnectionLifecycleState,
  event: ChatConnectionLifecycleEvent,
): ChatConnectionLifecycleState {
  return transitionConnectionWorkLifecycle(state, event);
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
