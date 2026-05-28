// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatViewDeferredTasks } from "../../../src/features/chat/view-lifecycle";

describe("ChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("coalesces scheduled renders and preserves forced slot rendering", async () => {
    const tasks = new ChatViewDeferredTasks(() => window);
    const render = vi.fn();

    tasks.scheduleRender(render);
    tasks.scheduleRender(render, { forceSlots: true });

    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith({ forceSlots: true });
  });

  it("clears scheduled deferred work", async () => {
    const tasks = new ChatViewDeferredTasks(() => window);
    const render = vi.fn();
    const diagnostics = vi.fn();
    const hydration = vi.fn();
    const warmup = vi.fn();

    tasks.scheduleRender(render, { forceSlots: true });
    tasks.scheduleDiagnostics(diagnostics);
    tasks.scheduleRestoredThreadHydration(hydration);
    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(render).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
    expect(hydration).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });
});
