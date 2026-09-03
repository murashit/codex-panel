import { describe, expect, it, vi } from "vitest";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { activeThreadState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createGoalCommands as createGoalCommandsImpl,
  type ThreadGoalEffects,
} from "../../../../../src/features/chat/application/threads/goal-commands";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

type GoalCommandsHost = Parameters<typeof createGoalCommandsImpl>[0];

function createGoalCommands(
  host: Omit<GoalCommandsHost, "ensureConnected" | "ensureRestoredThreadLoaded" | "startEditingGoal" | "observeThreadGoal"> &
    Partial<Pick<GoalCommandsHost, "ensureConnected" | "ensureRestoredThreadLoaded" | "startEditingGoal" | "observeThreadGoal">>,
) {
  const context = {
    ...host,
    ensureConnected: host.ensureConnected ?? (async () => true),
    ensureRestoredThreadLoaded: host.ensureRestoredThreadLoaded ?? (async () => true),
    startEditingGoal: host.startEditingGoal ?? vi.fn(),
    observeThreadGoal: host.observeThreadGoal ?? vi.fn(),
  };
  return createGoalCommandsImpl(context);
}

describe("createGoalCommands", () => {
  it("sets objective, status, and clears goals through app-server", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ tokenBudget: 500 }) } });
    const stateStore = createChatStateStore(state);
    const updated = goal({ objective: "Updated", tokenBudget: 250 });
    const paused = goal({ objective: "Updated", status: "paused", tokenBudget: 250 });
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce(completed(updated)).mockResolvedValueOnce(completed(paused)),
      clearThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
    });
    const { setThreadGoal, clearThreadGoal } = effects;
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const observeThreadGoal = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent,
      observeThreadGoal,
    });

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
    expect(observeThreadGoal).toHaveBeenNthCalledWith(1, "thread");
    expect(observeThreadGoal).toHaveBeenNthCalledWith(2, "thread");
    expect(observeThreadGoal).toHaveBeenNthCalledWith(3, "thread");
  });

  it("does not mark unavailable or failed goal mutations as committed", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread", goal: goal() } });
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValue({ kind: "not-started" }),
      clearThreadGoal: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.setObjective("thread", "Stale", null)).resolves.toBe(false);
    await expect(commands.clear("thread")).resolves.toBe(false);
  });

  it("lets app-server settle concurrent goal mutations", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const firstUpdate = deferred<EffectOutcome<ThreadGoal>>();
    const secondUpdate = deferred<EffectOutcome<ThreadGoal>>();
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockReturnValueOnce(firstUpdate.promise).mockReturnValueOnce(secondUpdate.promise),
    });
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const objectiveUpdate = commands.setObjective("thread", "Updated", null);
    await vi.waitFor(() => expect(effects.setThreadGoal).toHaveBeenCalledOnce());
    const statusUpdate = commands.setStatus("thread", "paused");
    await Promise.resolve();
    expect(effects.setThreadGoal).toHaveBeenCalledTimes(2);

    firstUpdate.resolve(completed(goal({ objective: "Updated" })));
    await expect(objectiveUpdate).resolves.toBe(true);
    secondUpdate.resolve(completed(goal({ objective: "Updated", status: "paused" })));
    await expect(statusUpdate).resolves.toBe(true);

    expect(effects.setThreadGoal).toHaveBeenNthCalledWith(1, "thread", {
      objective: "Updated",
      status: "active",
      tokenBudget: null,
    });
    expect(effects.setThreadGoal).toHaveBeenNthCalledWith(2, "thread", { status: "paused" });
    expect(activeThreadState(stateStore.getState())?.goal).toMatchObject({ objective: "Updated", status: "paused" });
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
    const effects = effectsFixture();
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "side" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.setObjective("side", "Ship", null)).resolves.toBe(false);
    await expect(commands.clear("side")).resolves.toBe(false);

    expect(effects.setThreadGoal).not.toHaveBeenCalled();
    expect(effects.clearThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).toHaveBeenCalledWith("Goals are unavailable in side chats.");
  });

  it("does not report stale goal action failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal() } });
    const stateStore = createChatStateStore(state);
    const update = deferred<never>();
    const effects = effectsFixture({ setThreadGoal: vi.fn().mockReturnValue(update.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.setStatus("thread", "paused");
    await vi.waitFor(() => expect(effects.setThreadGoal).toHaveBeenCalledOnce());
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
    const effects = effectsFixture({ clearThreadGoal: vi.fn().mockReturnValue(clear.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.clear("thread");
    await vi.waitFor(() => expect(effects.clearThreadGoal).toHaveBeenCalledOnce());
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
    const effects = effectsFixture();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const pending = commands.clear("thread");
    stateStore.dispatch({ type: "active-thread/cleared" });

    await expect(pending).resolves.toBe(false);
    expect(effects.clearThreadGoal).not.toHaveBeenCalled();
  });

  it("does not set a goal on an old panel target after connection completes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const connection = deferred<boolean>();
    const effects = effectsFixture();
    const ensureConnected = vi.fn(() => connection.promise);
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      ensureConnected,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    const pending = commands.setObjective("thread", "Finish", null);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    connection.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(effects.setThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("reports goal creation as a structured goal event", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completed(goal())) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
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
  });

  it("starts a thread before saving a new goal objective when no thread is active", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const savedGoal = goal({ threadId: "thread-new", objective: "Plan release" });
    const effects = effectsFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completed(savedGoal)) });
    const { setThreadGoal } = effects;
    const startThread = vi.fn().mockImplementation(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        canAcceptDirectInput: null,
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
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective(" Plan release ", null)).resolves.toBe(true);

    expect(startThread).toHaveBeenCalledWith("Plan release", { syncGoal: false });
    expect(setThreadGoal).toHaveBeenCalledWith("thread-new", { objective: "Plan release", status: "active", tokenBudget: null });
  });

  it("does not save a goal through a thread that was created but not activated", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const effects = effectsFixture();
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread: vi.fn().mockResolvedValue({ kind: "created-not-activated" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("Plan release", null)).resolves.toBe(false);

    expect(effects.setThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not start a goal thread when the empty panel changes during connection", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const connection = deferred<boolean>();
    const effects = effectsFixture();
    const ensureConnected = vi.fn(() => connection.promise);
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread-new" });
    const commands = createGoalCommands({
      stateStore,
      effects,
      ensureConnected,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const pending = commands.saveObjective("Plan release", null);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    connection.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(startThread).not.toHaveBeenCalled();
    expect(effects.setThreadGoal).not.toHaveBeenCalled();
  });

  it("loads an awaiting restored thread before saving its goal", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValue(completed(goal({ threadId: "restored", objective: "Resume work" }))),
    });
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "new-thread" });
    const ensureRestoredThreadLoaded = vi.fn(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        canAcceptDirectInput: null,
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
      effects,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      ensureRestoredThreadLoaded,
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("Resume work", null)).resolves.toBe(true);

    expect(ensureRestoredThreadLoaded).toHaveBeenCalledOnce();
    expect(startThread).not.toHaveBeenCalled();
    expect(effects.setThreadGoal).toHaveBeenCalledWith("restored", {
      objective: "Resume work",
      status: "active",
      tokenBudget: null,
    });
  });

  it("rejects empty goal objective saves before connecting or starting a thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const effects = effectsFixture();
    const ensureConnected = vi.fn().mockResolvedValue(true);
    const startThread = vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      ensureConnected,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      startThread,
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await expect(commands.saveObjective("   ", null)).resolves.toBe(false);

    expect(addSystemMessage).toHaveBeenCalledWith("Goal objective cannot be empty.");
    expect(ensureConnected).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
  });

  it("reports goal resume as a user-visible state change", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { activeThread: { goal: goal({ status: "paused" }) } });
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture({ setThreadGoal: vi.fn().mockResolvedValueOnce(completed(goal())) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
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

function effectsFixture(overrides: Partial<ThreadGoalEffects> = {}): ThreadGoalEffects {
  return {
    setThreadGoal: vi.fn().mockResolvedValue(completed(goal())),
    clearThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
    ...overrides,
  };
}

function completed<T>(value: T): EffectOutcome<T> {
  return { kind: "completed", value };
}
