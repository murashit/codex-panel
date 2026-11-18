// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { DeferredTask } from "../../../src/shared/async/deferred-task";
import { popoutWindow } from "../../support/dom";

describe("DeferredTask", () => {
  it("coalesces pending warmups and allows another after completion", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
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
    let owner = popoutWindow();
    const tasks = new DeferredTask(() => owner, 0);
    const stale = vi.fn();
    tasks.schedule(stale);
    owner = window;
    tasks.clear();
    await new Promise<void>((resolve) => tasks.schedule(resolve));
    expect(stale).not.toHaveBeenCalled();
  });
});
