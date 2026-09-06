// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeferredTask } from "../../../src/shared/async/deferred-task";

describe("DeferredTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces pending warmups and allows another after completion", async () => {
    const tasks = new DeferredTask(() => window, 0);
    const warmup = vi.fn();

    tasks.schedule(warmup);
    tasks.schedule(warmup);
    await vi.runOnlyPendingTimersAsync();
    expect(warmup).toHaveBeenCalledOnce();

    tasks.schedule(warmup);
    await vi.runOnlyPendingTimersAsync();
    expect(warmup).toHaveBeenCalledTimes(2);
  });

  it("clears scheduled deferred work", async () => {
    const tasks = new DeferredTask(() => window, 0);
    const warmup = vi.fn();

    tasks.schedule(warmup);
    tasks.clear();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(warmup).not.toHaveBeenCalled();
  });
});
