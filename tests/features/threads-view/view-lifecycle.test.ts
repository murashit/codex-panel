// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ThreadsViewDeferredTasks } from "../../../src/features/threads-view/view-lifecycle";

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
