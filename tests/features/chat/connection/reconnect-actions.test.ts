import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { reconnectPanel, type ChatReconnectActionsHost } from "../../../../src/features/chat/application/connection/reconnect-actions";

function createHost(overrides: Partial<ChatReconnectActionsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
  stateStore.dispatch({
    type: "active-thread/resumed",
    thread: { id: "thread" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
  const host: ChatReconnectActionsHost = {
    stateStore,
    invalidateConnectionWork: vi.fn(),
    invalidateThreadWork: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    resetConnection: vi.fn(),
    setStatus: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { host, stateStore };
}

describe("reconnectPanel", () => {
  it("resets local connection state before reconnecting and resumes the active thread", async () => {
    const { host, stateStore } = createHost();

    await reconnectPanel(host);

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.invalidateConnectionWork).toHaveBeenCalledOnce();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.clearDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.resetConnection).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Reconnecting...", { kind: "connecting" });
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it("reports resume failures after reconnecting", async () => {
    const { host } = createHost({
      resumeThread: vi.fn().mockRejectedValue(new Error("resume failed")),
    });

    await reconnectPanel(host);

    expect(host.addSystemMessage).toHaveBeenCalledWith("resume failed");
  });
});
