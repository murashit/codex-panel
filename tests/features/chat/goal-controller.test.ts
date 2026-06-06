import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { ChatGoalController } from "../../../src/features/chat/goal-controller";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import type { ThreadGoal } from "../../../src/generated/app-server/v2/ThreadGoal";

describe("ChatGoalController", () => {
  it("syncs the active thread goal into chat state", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const client = { getThreadGoal: vi.fn().mockResolvedValue({ goal: currentGoal }) } as unknown as AppServerClient;
    const render = vi.fn();
    const refreshLiveState = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage: vi.fn(),
      addUserMessage: vi.fn(),
      render,
      refreshLiveState,
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeGoal).toEqual(currentGoal);
    expect(refreshLiveState).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it("reports goal sync failures without clearing the active thread", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const stateStore = createChatStateStore(state);
    const addSystemMessage = vi.fn();
    const client = { getThreadGoal: vi.fn().mockRejectedValue(new Error("offline")) } as unknown as AppServerClient;
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addUserMessage: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThreadId).toBe("thread");
    expect(stateStore.getState().activeGoal).toBeNull();
    expect(addSystemMessage).toHaveBeenCalledWith("Could not load thread goal: offline");
  });

  it("sets objective, status, and clears goals through app-server", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.activeGoal = goal({ tokenBudget: 500 });
    const stateStore = createChatStateStore(state);
    const updated = goal({ objective: "Updated", tokenBudget: 250 });
    const paused = goal({ objective: "Updated", status: "paused", tokenBudget: 250 });
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: updated }).mockResolvedValueOnce({ goal: paused });
    const clearThreadGoal = vi.fn().mockResolvedValue({ cleared: true });
    const client = {
      setThreadGoal,
      clearThreadGoal,
    } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addUserMessage: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", " Updated ", 250);
    await controller.setStatus("thread", "paused");
    await controller.clear("thread");

    expect(setThreadGoal).toHaveBeenCalledWith("thread", { objective: "Updated", status: "active", tokenBudget: 250 });
    expect(setThreadGoal).toHaveBeenCalledWith("thread", { status: "paused" });
    expect(clearThreadGoal).toHaveBeenCalledWith("thread");
    expect(addSystemMessage).toHaveBeenCalledWith("Goal updated.");
    expect(addSystemMessage).toHaveBeenCalledWith("Goal paused.");
    expect(addSystemMessage).toHaveBeenCalledWith("Goal cleared.");
    expect(stateStore.getState().activeGoal).toBeNull();
  });

  it("reports goal creation as a user-visible state change", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal() });
    const injectThreadItems = vi.fn().mockResolvedValue({});
    const client = { setThreadGoal, injectThreadItems } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const addUserMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addUserMessage,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);

    expect(addSystemMessage).toHaveBeenCalledWith("Goal set.");
    expect(addUserMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "message", messageKind: "user", text: "Finish" }));
    expect(addUserMessage.mock.invocationCallOrder[0]).toBeLessThan(addSystemMessage.mock.invocationCallOrder[0] ?? 0);
    expect(injectThreadItems).toHaveBeenCalledWith("thread", [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Finish" }],
      },
    ]);
  });

  it("does not add a goal user message when editing an existing goal", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.activeGoal = goal();
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal({ objective: "Updated" }) });
    const injectThreadItems = vi.fn().mockResolvedValue({});
    const client = { setThreadGoal, injectThreadItems } as unknown as AppServerClient;
    const addUserMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage: vi.fn(),
      addUserMessage,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Updated", null);

    expect(addUserMessage).not.toHaveBeenCalled();
    expect(injectThreadItems).not.toHaveBeenCalled();
  });

  it("reports goal resume as a user-visible state change", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.activeGoal = goal({ status: "paused" });
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal() });
    const client = { setThreadGoal } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addUserMessage: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setStatus("thread", "active");

    expect(addSystemMessage).toHaveBeenCalledWith("Goal resumed.");
  });

  it("does not report initial goal sync as a user-visible state change", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const client = { getThreadGoal: vi.fn().mockResolvedValue({ goal: currentGoal }) } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addUserMessage: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeGoal).toEqual(currentGoal);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
