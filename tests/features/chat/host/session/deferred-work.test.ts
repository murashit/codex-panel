// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatViewDeferredTasks } from "../../../../../src/features/chat/host/session/deferred-work";

describe("createChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("clears scheduled deferred work", async () => {
    const tasks = createChatViewDeferredTasks(() => window);
    const diagnostics = vi.fn();
    const warmup = vi.fn();

    tasks.scheduleDiagnostics(diagnostics);
    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(diagnostics).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });
});
