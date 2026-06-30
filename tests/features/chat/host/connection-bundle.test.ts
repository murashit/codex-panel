import { describe, expect, it, vi } from "vitest";

import { scheduleDeferredDiagnosticsRefresh } from "../../../../src/features/chat/host/bundles/connection-bundle";

describe("connection bundle deferred diagnostics", () => {
  it("reports deferred diagnostics failures without returning a blocking promise", async () => {
    const callbacks: Array<() => void> = [];
    const error = new Error("diagnostics failed");
    const refreshServerDiagnostics = vi.fn().mockRejectedValue(error);
    const addSystemMessage = vi.fn();

    scheduleDeferredDiagnosticsRefresh({
      scheduleDiagnostics: (scheduled) => {
        callbacks.push(scheduled);
      },
      isConnected: () => true,
      refreshServerDiagnostics,
      addSystemMessage,
    });

    expect(callbacks).toHaveLength(1);
    const scheduled = callbacks[0];
    if (!scheduled) throw new Error("Expected deferred diagnostics callback.");
    scheduled();
    await Promise.resolve();

    expect(refreshServerDiagnostics).toHaveBeenCalledWith({ appServerMetadataSnapshot: true });
    expect(addSystemMessage).toHaveBeenCalledWith("diagnostics failed");
  });

  it("does not refresh deferred diagnostics after disconnect", () => {
    const callbacks: Array<() => void> = [];
    const refreshServerDiagnostics = vi.fn().mockResolvedValue(undefined);

    scheduleDeferredDiagnosticsRefresh({
      scheduleDiagnostics: (scheduled) => {
        callbacks.push(scheduled);
      },
      isConnected: () => false,
      refreshServerDiagnostics,
      addSystemMessage: vi.fn(),
    });

    const scheduled = callbacks[0];
    if (!scheduled) throw new Error("Expected deferred diagnostics callback.");
    scheduled();

    expect(refreshServerDiagnostics).not.toHaveBeenCalled();
  });
});
