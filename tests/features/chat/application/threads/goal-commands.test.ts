import { describe, expect, it, vi } from "vitest";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { activeThreadState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createGoalCommands as createGoalCommandsImpl } from "../../../../../src/features/chat/application/threads/goal-commands";
import type { ThreadGoalPort } from "../../../../../src/features/chat/application/threads/goal-ports";
import { createThreadGoalCoordinator } from "../../../../../src/features/chat/application/threads/thread-goal-coordinator";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

type GoalCommandsHost = Parameters<typeof createGoalCommandsImpl>[0];

function createGoalCommands(
  host: Omit<GoalCommandsHost, "ensureRestoredThreadLoaded" | "startEditingGoal"> &
    Partial<Pick<GoalCommandsHost, "ensureRestoredThreadLoaded" | "startEditingGoal">>,
  goalCoordinator?: Parameters<typeof createGoalCommandsImpl>[1],
) {
  const context = {
    ...host,
    ensureRestoredThreadLoaded: host.ensureRestoredThreadLoaded ?? (async () => true),
    startEditingGoal: host.startEditingGoal ?? vi.fn(),
  };
  return createGoalCommandsImpl(context, goalCoordinator ?? createThreadGoalCoordinator());
}

describe("createGoalCommands", () => {
  it("sets objective, status, and clears goals through app-server", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ tokenBudget: 500 }) } });
    const stateStore = createChatStateStore(state);
    const updated = goal({ objective: "Updated", tokenBudget: 250 });
    const paused = goal({ objective: "Updated", status: "paused", tokenBudget: 250 });
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(updated)).mockResolvedValueOnce(completedCurrent(paused)),
      clearThreadGoal: vi.fn().mockResolvedValue(completedCurrent(undefined)),
    });
    const { setThreadGoal, clearThreadGoal } = goalPort;
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const goalCoordinator = createThreadGoalCoordinator();
    const markMutationCommitted = vi.spyOn(goalCoordinator, "markMutationCommitted");
    const commands = createGoalCommands(
      {
        stateStore,
        goalPort,
        localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
        startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
        addSystemMessage,
        addGoalEvent,
      },
      goalCoordinator,
    );

    await commands.setObjective("thread", " Updated ", 250);
    await commands.setStatus("thread", "paused");
    await commands.clear("thread");

    expect(setThreadGoal).toHaveBeenCalledWith("thread", { objective: "Updated", status: "active", tokenBudget: 250 });
    expect(setThreadGoal).toHaveBeenCalledWith("thread", { status: "paused" });
    expect(clearThreadGoal).toHaveBeenCalledWith("thread");
    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal updated.");
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "updated: Updated", objective: "Updated" }));
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "paused: Updated", objective: "Updated" }));
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "cleared: Updated", objective: "Updated" }));
    expect(activeThreadState(stateStore.getState())?.goal).toBeNull();
    expect(markMutationCommitted).toHaveBeenNthCalledWith(1, "thread");
    expect(markMutationCommitted).toHaveBeenNthCalledWith(2, "thread");
    expect(markMutationCommitted).toHaveBeenNthCalledWith(3, "thread");
  });

  it("does not mark stale or failed goal mutations as committed", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread", goal: goal() } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValue({ kind: "completed-stale", value: goal({ objective: "Stale" }) }),
      clearThreadGoal: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const goalCoordinator = createThreadGoalCoordinator();
    const markMutationCommitted = vi.spyOn(goalCoordinator, "markMutationCommitted");
    const commands = createGoalCommands(
      {
        stateStore,
        goalPort,
        localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
        startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
        addSystemMessage: vi.fn(),
        addGoalEvent: vi.fn(),
      },
      goalCoordinator,
    );

    await expect(commands.setObjective("thread", "Stale", null)).resolves.toBe(false);
    await expect(commands.clear("thread")).resolves.toBe(false);

    expect(markMutationCommitted).not.toHaveBeenCalled();
  });

  it("serializes goal mutations for the same thread", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const firstUpdate = deferred<EffectOutcome<ThreadGoal>>();
    const goalPort = goalPortFixture({
      setThreadGoal: vi
        .fn()
        .mockReturnValueOnce(firstUpdate.promise)
        .mockResolvedValueOnce(completedCurrent(goal({ objective: "Updated", status: "paused" }))),
    });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const objectiveUpdate = commands.setObjective("thread", "Updated", null);
    await vi.waitFor(() => expect(goalPort.setThreadGoal).toHaveBeenCalledOnce());
    const statusUpdate = commands.setStatus("thread", "paused");
    await Promise.resolve();
    expect(goalPort.setThreadGoal).toHaveBeenCalledOnce();

    firstUpdate.resolve(completedCurrent(goal({ objective: "Updated" })));
    await expect(objectiveUpdate).resolves.toBe(true);
    await expect(statusUpdate).resolves.toBe(true);

    expect(goalPort.setThreadGoal).toHaveBeenNthCalledWith(1, "thread", {
      objective: "Updated",
      status: "active",
      tokenBudget: null,
    });
    expect(goalPort.setThreadGoal).toHaveBeenNthCalledWith(2, "thread", { status: "paused" });
    expect(activeThreadState(stateStore.getState())?.goal).toMatchObject({ objective: "Updated", status: "paused" });
  });

  it("serializes goal mutations for a thread across an A to B to A panel revision", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-a", goal: goal({ threadId: "thread-a" }) } });
    const stateStore = createChatStateStore(state);
    const firstUpdate = deferred<EffectOutcome<ThreadGoal>>();
    const goalPort = goalPortFixture({
      setThreadGoal: vi
        .fn()
        .mockReturnValueOnce(firstUpdate.promise)
        .mockResolvedValueOnce(completedCurrent(goal({ threadId: "thread-a", objective: "Latest", status: "paused" }))),
    });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread-a" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const oldUpdate = commands.setObjective("thread-a", "Old", null);
    await vi.waitFor(() => expect(goalPort.setThreadGoal).toHaveBeenCalledOnce());
    resumeInteractiveThread(stateStore, "thread-b");
    resumeInteractiveThread(stateStore, "thread-a");
    const latestUpdate = commands.setStatus("thread-a", "paused");
    await Promise.resolve();
    expect(goalPort.setThreadGoal).toHaveBeenCalledOnce();

    firstUpdate.resolve(completedCurrent(goal({ threadId: "thread-a", objective: "Old" })));
    await expect(oldUpdate).resolves.toBe(false);
    await expect(latestUpdate).resolves.toBe(true);
    expect(goalPort.setThreadGoal).toHaveBeenNthCalledWith(2, "thread-a", { status: "paused" });
  });

  it("serializes goal mutations for the same thread across panel sessions", async () => {
    const panelState = chatStateWith(chatStateFixture(), {
      activeThread: { id: "thread", goal: goal({ objective: "Initial" }) },
    });
    const firstStore = createChatStateStore(panelState);
    const secondStore = createChatStateStore(panelState);
    const firstUpdate = deferred<EffectOutcome<ThreadGoal>>();
    const firstPort = goalPortFixture({ setThreadGoal: vi.fn(() => firstUpdate.promise) });
    const secondPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValue(completedCurrent(goal({ objective: "Latest" }))),
    });
    const goalCoordinator = createThreadGoalCoordinator();
    const createPanelActions = (stateStore: ChatStateStore, goalPort: ThreadGoalPort) =>
      createGoalCommands(
        {
          stateStore,
          goalPort,
          localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
          startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
          addSystemMessage: vi.fn(),
          addGoalEvent: vi.fn(),
        },
        goalCoordinator,
      );
    const firstCommands = createPanelActions(firstStore, firstPort);
    const secondCommands = createPanelActions(secondStore, secondPort);

    const firstMutation = firstCommands.setObjective("thread", "Old", null);
    await vi.waitFor(() => expect(firstPort.setThreadGoal).toHaveBeenCalledOnce());
    const secondMutation = secondCommands.setObjective("thread", "Latest", null);
    await Promise.resolve();
    expect(secondPort.setThreadGoal).not.toHaveBeenCalled();

    firstUpdate.resolve(completedCurrent(goal({ objective: "Old" })));
    await expect(firstMutation).resolves.toBe(true);
    await vi.waitFor(() =>
      expect(secondPort.setThreadGoal).toHaveBeenCalledWith("thread", expect.objectContaining({ objective: "Latest" })),
    );
    await expect(secondMutation).resolves.toBe(true);
  });

  it("blocks goal mutations in side chats before calling app-server", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "side",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture();
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "side" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.setObjective("side", "Ship", null)).resolves.toBe(false);
    await expect(commands.clear("side")).resolves.toBe(false);

    expect(goalPort.setThreadGoal).not.toHaveBeenCalled();
    expect(goalPort.clearThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).toHaveBeenCalledWith("Goals are unavailable in side chats.");
  });

  it("does not report stale goal action failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const update = deferred<never>();
    const goalPort = goalPortFixture({ setThreadGoal: vi.fn().mockReturnValue(update.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.setStatus("thread", "paused");
    await vi.waitFor(() => expect(goalPort.setThreadGoal).toHaveBeenCalledOnce());
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
    const goalPort = goalPortFixture({ clearThreadGoal: vi.fn().mockReturnValue(clear.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.clear("thread");
    await vi.waitFor(() => expect(goalPort.clearThreadGoal).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    clear.reject(new Error("offline"));
    await pending;

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not clear a stale goal when the active thread changes during the policy guard", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const pending = commands.clear("thread");
    stateStore.dispatch({ type: "active-thread/cleared" });

    await expect(pending).resolves.toBe(false);
    expect(goalPort.clearThreadGoal).not.toHaveBeenCalled();
  });

  it("does not set a goal on an old panel target after connection completes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const connection = deferred<boolean>();
    const goalPort = goalPortFixture({ ensureConnected: vi.fn(() => connection.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.setObjective("thread", "Finish", null);
    await vi.waitFor(() => expect(goalPort.ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    connection.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(goalPort.setThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("reports goal creation as a structured goal event", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(goal())) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
    });

    await commands.setObjective("thread", "Finish", null);

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
    expect(goalPort.recordThreadGoalUserMessage).toHaveBeenCalledWith("thread", "Finish");
  });

  it("starts a thread before saving a new goal objective when no thread is active", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const savedGoal = goal({ threadId: "thread-new", objective: "Plan release" });
    const goalPort = goalPortFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(savedGoal)) });
    const { setThreadGoal } = goalPort;
    const startThread = vi.fn().mockImplementation(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: null,
        sandboxPolicy: null,
        activePermissionProfile: null,
        thread: {
          id: "thread-new",
          name: null,
          preview: "Plan release",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          provenance: { kind: "interactive" },
        },
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
      });
      return { kind: "created-activated" as const, threadId: "thread-new" };
    });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective(" Plan release ", null)).resolves.toBe(true);

    expect(startThread).toHaveBeenCalledWith("Plan release", { syncGoal: false });
    expect(setThreadGoal).toHaveBeenCalledWith("thread-new", { objective: "Plan release", status: "active", tokenBudget: null });
    expect(goalPort.recordThreadGoalUserMessage).toHaveBeenCalledWith("thread-new", "Plan release");
  });

  it("does not save a goal through a thread that was created but not activated", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const goalPort = goalPortFixture();
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-not-activated", threadId: "thread-new" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("Plan release", null)).resolves.toBe(false);

    expect(goalPort.setThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).toHaveBeenCalledWith(
      "Created thread thread-new, but the connection changed before it could be opened. Resume it from history before setting its goal.",
    );
  });

  it("does not start a goal thread when the empty panel changes during connection", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const connection = deferred<boolean>();
    const goalPort = goalPortFixture({ ensureConnected: vi.fn(() => connection.promise) });
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread-new" });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const pending = commands.saveObjective("Plan release", null);
    await vi.waitFor(() => expect(goalPort.ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    connection.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(startThread).not.toHaveBeenCalled();
    expect(goalPort.setThreadGoal).not.toHaveBeenCalled();
  });

  it("loads an awaiting restored thread before saving its goal", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValue(completedCurrent(goal({ threadId: "restored", objective: "Resume work" }))),
    });
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "new-thread" });
    const ensureRestoredThreadLoaded = vi.fn(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: null,
        sandboxPolicy: null,
        activePermissionProfile: null,
        thread: {
          id: "restored",
          preview: "Restored",
          createdAt: 1,
          updatedAt: 1,
          name: null,
          archived: false,
          provenance: { kind: "interactive" },
        },
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
      });
      return true;
    });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      ensureRestoredThreadLoaded,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("Resume work", null)).resolves.toBe(true);

    expect(ensureRestoredThreadLoaded).toHaveBeenCalledOnce();
    expect(startThread).not.toHaveBeenCalled();
    expect(goalPort.setThreadGoal).toHaveBeenCalledWith("restored", {
      objective: "Resume work",
      status: "active",
      tokenBudget: null,
    });
  });

  it("rejects empty goal objective saves before connecting or starting a thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const goalPort = goalPortFixture();
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("   ", null)).resolves.toBe(false);

    expect(addSystemMessage).toHaveBeenCalledWith("Goal objective cannot be empty.");
    expect(goalPort.ensureConnected).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
  });

  it("reports goal user history injection failures while the thread remains active", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(goal())),
      recordThreadGoalUserMessage: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await commands.setObjective("thread", "Finish", null);

    expect(addSystemMessage).toHaveBeenCalledWith("Could not record goal message: offline");
  });

  it("does not report stale goal user history injection failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(goal())),
      recordThreadGoalUserMessage: vi.fn().mockImplementation(async () => {
        stateStore.dispatch({ type: "active-thread/cleared" });
        throw new Error("offline");
      }),
    });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await commands.setObjective("thread", "Finish", null);

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("records a committed new goal even when its panel target changes before publication", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockImplementation(async () => {
        stateStore.dispatch({ type: "active-thread/cleared" });
        return completedCurrent(goal());
      }),
    });
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.setObjective("thread", "Finish", null)).resolves.toBe(false);

    expect(goalPort.recordThreadGoalUserMessage).toHaveBeenCalledWith("thread", "Finish");
  });

  it("does not inject a goal user history message when editing an existing goal", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(goal({ objective: "Updated" }))),
    });
    const addGoalEvent = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent,
    });

    await commands.setObjective("thread", "Updated", null);

    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "updated: Updated", objective: "Updated" }));
    expect(goalPort.recordThreadGoalUserMessage).not.toHaveBeenCalled();
  });

  it("reports goal resume as a user-visible state change", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ status: "paused" }) } });
    const stateStore = createChatStateStore(state);
    const goalPort = goalPortFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completedCurrent(goal())) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      goalPort,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
    });

    await commands.setStatus("thread", "active");

    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal resumed.");
    expect(addGoalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", text: "resumed: Finish", objective: "Finish" }));
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

function goalPortFixture(overrides: Partial<ThreadGoalPort> = {}): ThreadGoalPort {
  return {
    readThreadGoal: vi.fn().mockResolvedValue(null),
    setThreadGoal: vi.fn().mockResolvedValue(completedCurrent(goal())),
    clearThreadGoal: vi.fn().mockResolvedValue(completedCurrent(undefined)),
    recordThreadGoalUserMessage: vi.fn().mockResolvedValue(true),
    ensureConnected: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function resumeInteractiveThread(stateStore: ChatStateStore, threadId: string): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: {
      id: threadId,
      name: null,
      preview: threadId,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    },
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function completedCurrent<T>(value: T): EffectOutcome<T> {
  return { kind: "completed-current", value };
}
