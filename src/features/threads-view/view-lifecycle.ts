import {
  transitionConnectionWorkLifecycle,
  type ActiveConnectionWork,
  type ConnectionWorkLifecycleEvent,
  type ConnectionWorkLifecycleState,
} from "../../shared/lifecycle/connection-work";
import { DeferredTask, type DeferredTaskWindow } from "../../shared/lifecycle/deferred-task";

export type ThreadsViewRefreshLifecycleState = { kind: "idle" } | { kind: "loading" };
export type ActiveThreadsViewRefresh = Extract<ThreadsViewRefreshLifecycleState, { kind: "loading" }>;
export type ThreadsViewRefreshLifecycleEvent =
  | { type: "started"; refresh: ActiveThreadsViewRefresh }
  | { type: "finished"; refresh: ActiveThreadsViewRefresh }
  | { type: "invalidated" };

export type ThreadsViewConnectionLifecycleState = ConnectionWorkLifecycleState;
export type ActiveThreadsViewConnection = ActiveConnectionWork;
export type ThreadsViewConnectionLifecycleEvent = ConnectionWorkLifecycleEvent;

export class ThreadsViewDeferredTasks {
  private readonly renderTask: DeferredTask;
  private readonly refreshTask: DeferredTask;

  constructor(getWindow: () => DeferredTaskWindow) {
    this.renderTask = new DeferredTask(getWindow, 0);
    this.refreshTask = new DeferredTask(getWindow, 250);
  }

  scheduleRender(callback: () => void): void {
    this.renderTask.schedule(callback);
  }

  scheduleRefresh(callback: () => void): void {
    this.refreshTask.schedule(callback);
  }

  clearAll(): void {
    this.clearRender();
    this.clearRefresh();
  }

  private clearRender(): void {
    this.renderTask.clear();
  }

  private clearRefresh(): void {
    this.refreshTask.clear();
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
  return transitionConnectionWorkLifecycle(state, event);
}
