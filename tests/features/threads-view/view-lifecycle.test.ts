// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  ThreadsViewDeferredTasks,
  transitionThreadsViewConnectionLifecycle,
  transitionThreadsViewRefreshLifecycle,
  type ActiveThreadsViewConnection,
  type ActiveThreadsViewRefresh,
} from "../../../src/features/threads-view/view-lifecycle";

describe("ThreadsViewDeferredTasks", () => {
  it("coalesces render and refresh callbacks", () => {
    vi.useFakeTimers();
    try {
      const tasks = new ThreadsViewDeferredTasks(() => window);
      const render = vi.fn();
      const refresh = vi.fn();

      tasks.scheduleRender(render);
      tasks.scheduleRender(render);
      tasks.scheduleRefresh(refresh);
      tasks.scheduleRefresh(refresh);

      vi.advanceTimersByTime(0);
      expect(render).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();

      vi.advanceTimersByTime(250);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending callbacks", () => {
    vi.useFakeTimers();
    try {
      const tasks = new ThreadsViewDeferredTasks(() => window);
      const render = vi.fn();
      const refresh = vi.fn();

      tasks.scheduleRender(render);
      tasks.scheduleRefresh(refresh);
      tasks.clearAll();
      vi.runAllTimers();

      expect(render).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("threads view lifecycle transitions", () => {
  it("keeps stale refresh completion from clearing the active refresh", () => {
    const first: ActiveThreadsViewRefresh = { kind: "loading" };
    const second: ActiveThreadsViewRefresh = { kind: "loading" };
    const state = transitionThreadsViewRefreshLifecycle({ kind: "idle" }, { type: "started", refresh: second });

    expect(transitionThreadsViewRefreshLifecycle(state, { type: "finished", refresh: first })).toBe(state);
    expect(transitionThreadsViewRefreshLifecycle(state, { type: "finished", refresh: second })).toEqual({ kind: "idle" });
  });

  it("keeps stale connection completion from clearing the active connection", () => {
    const firstPromise = Promise.resolve();
    const secondPromise = Promise.resolve();
    const first: ActiveThreadsViewConnection = { kind: "connecting", promise: firstPromise };
    const second: ActiveThreadsViewConnection = { kind: "connecting", promise: secondPromise };
    const state = transitionThreadsViewConnectionLifecycle({ kind: "idle" }, { type: "started", connection: second });

    expect(transitionThreadsViewConnectionLifecycle(state, { type: "finished", connection: first, promise: firstPromise })).toBe(state);
    expect(transitionThreadsViewConnectionLifecycle(state, { type: "finished", connection: second, promise: firstPromise })).toBe(state);
    expect(transitionThreadsViewConnectionLifecycle(state, { type: "finished", connection: second, promise: secondPromise })).toEqual({
      kind: "idle",
    });
  });
});
