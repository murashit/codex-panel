import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createGoalActions } from "../../../../../src/features/chat/application/threads/goal-actions";
import type { ThreadGoalTransport } from "../../../../../src/features/chat/application/threads/goal-transport";
import { createLocalIdSource } from "../../../../../src/shared/id/local-id";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("createGoalActions", () => {
  it("syncs the active thread goal into chat state", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const goalTransport = goalTransportFixture({ readThreadGoal: vi.fn().mockResolvedValue(currentGoal) });
    const refreshLiveState = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
      refreshLiveState,
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThread.goal).toEqual(currentGoal);
    expect(refreshLiveState).toHaveBeenCalledOnce();
  });

  it("reports goal sync failures without clearing the active thread", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const addSystemMessage = vi.fn();
    const goalTransport = goalTransportFixture({ readThreadGoal: vi.fn().mockRejectedValue(new Error("offline")) });
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.syncThreadGoal("thread");

    expect(stateStore.getState().activeThread.id).toBe("thread");
    expect(stateStore.getState().activeThread.goal).toBeNull();
    expect(addSystemMessage).toHaveBeenCalledWith("Could not load thread goal: offline");
  });

  it("sets objective, status, and clears goals through app-server", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ tokenBudget: 500 }) } });
    const stateStore = createChatStateStore(state);
    const updated = goal({ objective: "Updated", tokenBudget: 250 });
    const paused = goal({ objective: "Updated", status: "paused", tokenBudget: 250 });
    const goalTransport = goalTransportFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(updated).mockResolvedValueOnce(paused),
      clearThreadGoal: vi.fn().mockResolvedValue(true),
    });
    const { setThreadGoal, clearThreadGoal } = goalTransport;
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
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

  it("does not report stale goal action failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const update = deferred<never>();
    const goalTransport = goalTransportFixture({ setThreadGoal: vi.fn().mockReturnValue(update.promise) });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    const pending = controller.setStatus("thread", "paused");
    await Promise.resolve();
    stateStore.dispatch({ type: "active-thread/cleared" });
    update.reject(new Error("offline"));
    await pending;

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not report stale goal clear failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const clear = deferred<never>();
    const goalTransport = goalTransportFixture({ clearThreadGoal: vi.fn().mockReturnValue(clear.promise) });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    const pending = controller.clear("thread");
    await Promise.resolve();
    stateStore.dispatch({ type: "active-thread/cleared" });
    clear.reject(new Error("offline"));
    await pending;

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("reports goal creation as a structured goal event", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalTransport = goalTransportFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(goal()) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);

    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal set.");
    expect(addGoalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "goal",
        role: "tool",
        text: "set: Finish",
        action: "set",
        objective: "Finish",
      }),
    );
    expect(goalTransport.recordThreadGoalUserMessage).toHaveBeenCalledWith("thread", "Finish");
  });

  it("starts a thread before saving a new goal objective when no thread is active", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const savedGoal = goal({ threadId: "thread-new", objective: "Plan release" });
    const goalTransport = goalTransportFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(savedGoal) });
    const { setThreadGoal } = goalTransport;
    const startThread = vi.fn().mockImplementation(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        thread: { id: "thread-new", name: null, preview: "Plan release", archived: false, createdAt: 1, updatedAt: 1 },
        cwd: "/vault",
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
      });
      return { threadId: "thread-new" };
    });
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await expect(controller.saveObjective(" Plan release ", null)).resolves.toBe(true);

    expect(startThread).toHaveBeenCalledWith("Plan release", { syncGoal: false });
    expect(setThreadGoal).toHaveBeenCalledWith("thread-new", { objective: "Plan release", status: "active", tokenBudget: null });
    expect(goalTransport.recordThreadGoalUserMessage).toHaveBeenCalledWith("thread-new", "Plan release");
  });

  it("rejects empty goal objective saves before connecting or starting a thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const goalTransport = goalTransportFixture();
    const startThread = vi.fn().mockResolvedValue({ threadId: "thread" });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await expect(controller.saveObjective("   ", null)).resolves.toBe(false);

    expect(addSystemMessage).toHaveBeenCalledWith("Goal objective cannot be empty.");
    expect(goalTransport.ensureConnected).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
  });

  it("reports goal user history injection failures while the thread remains active", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalTransport = goalTransportFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(goal()),
      recordThreadGoalUserMessage: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);

    expect(addSystemMessage).toHaveBeenCalledWith("Could not record goal message: offline");
  });

  it("does not report stale goal user history injection failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalTransport = goalTransportFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(goal()),
      recordThreadGoalUserMessage: vi.fn().mockImplementation(async () => {
        stateStore.dispatch({ type: "active-thread/cleared" });
        throw new Error("offline");
      }),
    });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Finish", null);

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not inject a goal user history message when editing an existing goal", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const goalTransport = goalTransportFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(goal({ objective: "Updated" })) });
    const addGoalEvent = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent,
      refreshLiveState: vi.fn(),
    });

    await controller.setObjective("thread", "Updated", null);

    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "updated: Updated", objective: "Updated" }));
    expect(goalTransport.recordThreadGoalUserMessage).not.toHaveBeenCalled();
  });

  it("reports goal resume as a user-visible state change", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ status: "paused" }) } });
    const stateStore = createChatStateStore(state);
    const goalTransport = goalTransportFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(goal()) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
      refreshLiveState: vi.fn(),
    });

    await controller.setStatus("thread", "active");

    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal resumed.");
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "resumed: Finish", objective: "Finish" }));
  });

  it("does not report initial goal sync as a user-visible state change", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const goalTransport = goalTransportFixture({ readThreadGoal: vi.fn().mockResolvedValue(currentGoal) });
    const addSystemMessage = vi.fn();
    const controller = createGoalActions({
      stateStore,
      goalTransport,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
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

function goalTransportFixture(overrides: Partial<ThreadGoalTransport> = {}): ThreadGoalTransport {
  return {
    readThreadGoal: vi.fn().mockResolvedValue(null),
    setThreadGoal: vi.fn().mockResolvedValue(goal()),
    clearThreadGoal: vi.fn().mockResolvedValue(true),
    recordThreadGoalUserMessage: vi.fn().mockResolvedValue(true),
    ensureConnected: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}
