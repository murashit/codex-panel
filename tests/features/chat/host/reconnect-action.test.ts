import { describe, expect, it, vi } from "vitest";

import { ConnectionManager } from "../../../../src/app-server/connection/connection-manager";
import { ConnectionWorkTracker } from "../../../../src/features/chat/application/connection/connection-work";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createReconnectAction } from "../../../../src/features/chat/host/bundles/reconnect-bundle";
import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/session/deferred-work";

describe("createReconnectAction", () => {
  it("wires host connection lifecycle cleanup into panel reconnect", async () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: { id: "thread-1" } as never,
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const connectionWork = new ConnectionWorkTracker();
    const activeConnectionWork = connectionWork.begin();
    const deferredTasks = createChatViewDeferredTasks(() => ({ setTimeout, clearTimeout }) as Pick<Window, "setTimeout" | "clearTimeout">);
    const connection = new ConnectionManager(() => "codex", "/vault");
    const resetConnection = vi.spyOn(connection, "resetConnection");
    const clearDiagnostics = vi.spyOn(deferredTasks, "clearDiagnostics");
    const status = {
      set: vi.fn(),
      addSystemMessage: vi.fn(),
    };
    const ensureConnected = vi.fn().mockResolvedValue(undefined);
    const resumeThread = vi.fn().mockResolvedValue(undefined);
    const reconnect = createReconnectAction(
      {
        stateStore,
        connectionWork,
        deferredTasks,
      },
      {
        connection,
        ensureConnected,
        invalidateThreadWork: vi.fn(),
        resumeThread,
        status,
      },
    );

    await reconnect();

    expect(connectionWork.isStale(activeConnectionWork)).toBe(true);
    expect(clearDiagnostics).toHaveBeenCalledOnce();
    expect(resetConnection).toHaveBeenCalledOnce();
    expect(status.set).toHaveBeenCalledWith("Reconnecting...", { kind: "connecting" });
    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(resumeThread).toHaveBeenCalledWith("thread-1");
  });
});
