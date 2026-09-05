// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChatViewDeferredTasks } from "../../../../../src/features/chat/host/session/deferred-work";

describe("createChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces pending warmups and allows another after completion", async () => {
    const tasks = createChatViewDeferredTasks(() => window);
    const warmup = vi.fn();

    tasks.scheduleAppServerWarmup(warmup);
    tasks.scheduleAppServerWarmup(warmup);
    await vi.runOnlyPendingTimersAsync();
    expect(warmup).toHaveBeenCalledOnce();

    tasks.scheduleAppServerWarmup(warmup);
    await vi.runOnlyPendingTimersAsync();
    expect(warmup).toHaveBeenCalledTimes(2);
  });

  it("clears scheduled deferred work", async () => {
    const tasks = createChatViewDeferredTasks(() => window);
    const warmup = vi.fn();

    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(warmup).not.toHaveBeenCalled();
  });
});
