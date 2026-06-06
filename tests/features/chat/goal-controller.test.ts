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
    const setThreadGoal = vi.fn().mockResolvedValue({ goal: updated });
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

  it("reports goal creation and resume as user-visible system messages", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValue({ goal: goal() });
    const client = { setThreadGoal } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const controller = new ChatGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);
    await controller.setStatus("thread", "active");

    expect(addSystemMessage).toHaveBeenCalledWith("Goal set.");
    expect(addSystemMessage).toHaveBeenCalledWith("Goal resumed.");
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
