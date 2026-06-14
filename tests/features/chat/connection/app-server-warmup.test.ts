// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/lifecycle";
import { scheduleChatPanelWarmup } from "../../../../src/features/chat/host/session";

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

describe("scheduleChatPanelWarmup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("connects on the next tick when the opened view is disconnected", async () => {
    const { host, ensureConnected } = createWarmupHost();

    scheduleChatPanelWarmup(host);
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).toHaveBeenCalledOnce();
  });

  it("does not schedule warmup when the view is closed or already connected", async () => {
    const closed = createWarmupHost({ opened: false });
    const connected = createWarmupHost({ connected: true });

    scheduleChatPanelWarmup(closed.host);
    scheduleChatPanelWarmup(connected.host);

    await vi.advanceTimersByTimeAsync(0);

    expect(closed.ensureConnected).not.toHaveBeenCalled();
    expect(connected.ensureConnected).not.toHaveBeenCalled();
  });

  it("skips a scheduled warmup if the view is closing", async () => {
    const { host, ensureConnected } = createWarmupHost({ closing: true });

    scheduleChatPanelWarmup(host);
    await vi.advanceTimersByTimeAsync(0);

    expect(ensureConnected).not.toHaveBeenCalled();
  });
});
