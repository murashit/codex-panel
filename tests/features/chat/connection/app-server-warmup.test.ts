// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleAppServerWarmup } from "../../../../src/features/chat/application/connection/app-server-warmup";
import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/lifecycle";

function createWarmupHost({
  opened = true,
  closing = false,
  connected = false,
}: { opened?: boolean; closing?: boolean; connected?: boolean } = {}) {
  const ensureConnected = vi.fn().mockResolvedValue(undefined);
  const host = {
    deferredTasks: createChatViewDeferredTasks(() => window),
    opened: () => opened,
    closing: () => closing,
    connected: () => connected,
    ensureConnected,
  };
  return { host, ensureConnected };
}

describe("scheduleAppServerWarmup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("connects on the next tick when the opened view is disconnected", async () => {
    const { host, ensureConnected } = createWarmupHost();

    scheduleAppServerWarmup(host);
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).toHaveBeenCalledOnce();
  });

  it("does not schedule warmup when the view is closed or already connected", async () => {
    const closed = createWarmupHost({ opened: false });
    const connected = createWarmupHost({ connected: true });

    scheduleAppServerWarmup(closed.host);
    scheduleAppServerWarmup(connected.host);

    await vi.advanceTimersByTimeAsync(0);

    expect(closed.ensureConnected).not.toHaveBeenCalled();
    expect(connected.ensureConnected).not.toHaveBeenCalled();
  });

  it("skips a scheduled warmup if the view is closing", async () => {
    const { host, ensureConnected } = createWarmupHost({ closing: true });

    scheduleAppServerWarmup(host);
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).not.toHaveBeenCalled();
  });
});
