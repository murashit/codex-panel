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

export interface ThreadsViewDeferredTasks {
  scheduleRender(callback: () => void): void;
  scheduleRefresh(callback: () => void): void;
  clearAll(): void;
}

export function createThreadsViewDeferredTasks(getWindow: () => DeferredTaskWindow): ThreadsViewDeferredTasks {
  const renderTask = new DeferredTask(getWindow, 0);
  const refreshTask = new DeferredTask(getWindow, 250);

  return {
    scheduleRender(callback): void {
      renderTask.schedule(callback);
    },

    scheduleRefresh(callback): void {
      refreshTask.schedule(callback);
    },

    clearAll(): void {
      renderTask.clear();
      refreshTask.clear();
    },
  };
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
