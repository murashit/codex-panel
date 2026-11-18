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

  it("cancels work in the scheduling window after a panel moves", async () => {
    vi.useRealTimers();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const original = frame.contentWindow;
      if (!original) throw new Error("Missing frame window");
      let owner: Window = original;
      const tasks = new DeferredTask(() => owner, 0);
      const stale = vi.fn();
      tasks.schedule(stale);
      owner = window;
      tasks.clear();
      await new Promise<void>((resolve) => tasks.schedule(resolve));
      expect(stale).not.toHaveBeenCalled();
    } finally {
      frame.remove();
    }
  });
});
