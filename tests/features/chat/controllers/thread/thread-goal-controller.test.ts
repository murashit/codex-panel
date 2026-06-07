import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { ChatThreadGoalController } from "../../../../../src/features/chat/controllers/thread/thread-goal-controller";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import type { ThreadGoal } from "../../../../../src/generated/app-server/v2/ThreadGoal";

describe("ChatThreadGoalController", () => {
  it("syncs the active thread goal into chat state", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const client = { getThreadGoal: vi.fn().mockResolvedValue({ goal: currentGoal }) } as unknown as AppServerClient;
    const render = vi.fn();
    const refreshLiveState = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
      render,
      refreshLiveState,
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThread.goal).toEqual(currentGoal);
    expect(refreshLiveState).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it("reports goal sync failures without clearing the active thread", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const stateStore = createChatStateStore(state);
    const addSystemMessage = vi.fn();
    const client = { getThreadGoal: vi.fn().mockRejectedValue(new Error("offline")) } as unknown as AppServerClient;
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThread.id).toBe("thread");
    expect(stateStore.getState().activeThread.goal).toBeNull();
    expect(addSystemMessage).toHaveBeenCalledWith("Could not load thread goal: offline");
  });

  it("sets objective, status, and clears goals through app-server", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.activeThread.goal = goal({ tokenBudget: 500 });
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
    const addGoalEvent = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addGoalEvent,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", " Updated ", 250);
    await controller.setStatus("thread", "paused");
    await controller.clear("thread");

    expect(setThreadGoal).toHaveBeenCalledWith("thread", { objective: "Updated", status: "active", tokenBudget: 250 });
    expect(setThreadGoal).toHaveBeenCalledWith("thread", { status: "paused" });
    expect(clearThreadGoal).toHaveBeenCalledWith("thread");
    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal updated.");
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "updated: Updated", objective: "Updated" }));
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "paused: Updated", objective: "Updated" }));
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "cleared: Updated", objective: "Updated" }));
    expect(stateStore.getState().activeThread.goal).toBeNull();
  });

  it("reports goal creation as a structured goal event", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal() });
    const injectThreadItems = vi.fn().mockResolvedValue({});
    const client = { setThreadGoal, injectThreadItems } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addGoalEvent,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);

    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal set.");
    expect(addGoalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "goal",
        role: "tool",
        text: "set: Finish",
        objective: "Finish",
        details: [{ rows: [{ key: "action", value: "set" }] }, { title: "Objective", body: "Finish" }],
      }),
    );
    expect(injectThreadItems).toHaveBeenCalledWith("thread", [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Finish" }],
      },
    ]);
  });

  it("does not inject a goal user history message when editing an existing goal", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.activeThread.goal = goal();
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal({ objective: "Updated" }) });
    const injectThreadItems = vi.fn().mockResolvedValue({});
    const client = { setThreadGoal, injectThreadItems } as unknown as AppServerClient;
    const addGoalEvent = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage: vi.fn(),
      addGoalEvent,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Updated", null);

    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "updated: Updated", objective: "Updated" }));
    expect(injectThreadItems).not.toHaveBeenCalled();
  });

  it("reports goal resume as a user-visible state change", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.activeThread.goal = goal({ status: "paused" });
    const stateStore = createChatStateStore(state);
    const setThreadGoal = vi.fn().mockResolvedValueOnce({ goal: goal() });
    const client = { setThreadGoal } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addGoalEvent,
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setStatus("thread", "active");

    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal resumed.");
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "resumed: Finish", objective: "Finish" }));
  });

  it("does not report initial goal sync as a user-visible state change", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const client = { getThreadGoal: vi.fn().mockResolvedValue({ goal: currentGoal }) } as unknown as AppServerClient;
    const addSystemMessage = vi.fn();
    const controller = new ChatThreadGoalController({
      stateStore,
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      render: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThread.goal).toEqual(currentGoal);
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
