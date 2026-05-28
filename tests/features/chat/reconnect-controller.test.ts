import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { ChatReconnectController, type ChatReconnectControllerHost } from "../../../src/features/chat/reconnect-controller";

function createHost(overrides: Partial<ChatReconnectControllerHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
  const host: ChatReconnectControllerHost = {
    stateStore,
    activeThreadId: () => "thread",
    invalidateConnectionWork: vi.fn(),
    invalidateResumeWork: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    reconnect: vi.fn(),
    clearClient: vi.fn(),
    setStatus: vi.fn(),
    render: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { host, stateStore };
}

describe("ChatReconnectController", () => {
  it("resets local connection state before reconnecting and resumes the active thread", async () => {
    const { host, stateStore } = createHost();
    const controller = new ChatReconnectController(host);

    await controller.reconnectFromToolbar();

    expect(stateStore.getState().openDetails.size).toBe(0);
    expect(host.invalidateConnectionWork).toHaveBeenCalledOnce();
    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.clearDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.reconnect).toHaveBeenCalledOnce();
    expect(host.clearClient).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Reconnecting...");
    expect(host.render).toHaveBeenCalledOnce();
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it("reports resume failures after reconnecting", async () => {
    const { host } = createHost({
      resumeThread: vi.fn().mockRejectedValue(new Error("resume failed")),
    });
    const controller = new ChatReconnectController(host);

    await controller.reconnectFromToolbar();

    expect(host.addSystemMessage).toHaveBeenCalledWith("resume failed");
  });
});
