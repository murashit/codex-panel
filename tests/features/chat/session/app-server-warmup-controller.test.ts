// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAppServerWarmupActions } from "../../../../src/features/chat/session/app-server-warmup-controller";
import { ChatViewDeferredTasks } from "../../../../src/features/chat/panel/lifecycle";

function createController({
  opened = true,
  closing = false,
  connected = false,
}: { opened?: boolean; closing?: boolean; connected?: boolean } = {}) {
  const ensureConnected = vi.fn().mockResolvedValue(undefined);
  const controller = createAppServerWarmupActions({
    deferredTasks: new ChatViewDeferredTasks(() => window),
    opened: () => opened,
    closing: () => closing,
    connected: () => connected,
    ensureConnected,
  });
  return { controller, ensureConnected };
}

describe("AppServerWarmupController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("connects on the next tick when the opened view is disconnected", async () => {
    const { controller, ensureConnected } = createController();

    controller.schedule();
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).toHaveBeenCalledOnce();
  });

  it("does not schedule warmup when the view is closed or already connected", async () => {
    const closed = createController({ opened: false });
    const connected = createController({ connected: true });

    closed.controller.schedule();
    connected.controller.schedule();

    await vi.advanceTimersByTimeAsync(0);

    expect(closed.ensureConnected).not.toHaveBeenCalled();
    expect(connected.ensureConnected).not.toHaveBeenCalled();
  });

  it("skips a scheduled warmup if the view is closing", async () => {
    const { controller, ensureConnected } = createController({ closing: true });

    controller.schedule();
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).not.toHaveBeenCalled();
  });
});
