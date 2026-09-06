import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { activeThreadId } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createGoalCommands as createGoalCommandsImpl,
  type ThreadGoalEffects,
} from "../../../../../src/features/chat/application/threads/goal-commands";
import { createThreadStartCommand } from "../../../../../src/features/chat/application/threads/thread-start-command";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

type GoalCommandsHost = Parameters<typeof createGoalCommandsImpl>[0];

function createGoalCommands(
  host: Omit<GoalCommandsHost, "ensureConnected" | "ensureRestoredThreadLoaded" | "goalQueries"> &
    Partial<Pick<GoalCommandsHost, "ensureConnected" | "ensureRestoredThreadLoaded" | "goalQueries">>,
) {
  const goals = new Map<string, ThreadGoal | null>();
  const threadId = activeThreadId(host.stateStore.getState());
  if (threadId) goals.set(threadId, goal());
  const context = {
    ...host,
    ensureConnected: host.ensureConnected ?? (async () => true),
    ensureRestoredThreadLoaded: host.ensureRestoredThreadLoaded ?? (async () => true),
    goalQueries:
      host.goalQueries ??
      ({
        snapshot: (id: string) => goals.get(id),
      } satisfies GoalCommandsHost["goalQueries"]),
  };
  return createGoalCommandsImpl(context);
}

describe("createGoalCommands", () => {
  it("sets objective, status, and clears goals through app-server", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
      clearThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
    });
    const { setThreadGoal, clearThreadGoal } = effects;
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
    });

    await commands.setObjective(" Updated ", 250);
    await commands.setStatus("thread", "paused");
    await commands.clear("thread");

    expect(setThreadGoal).toHaveBeenCalledWith("thread", { objective: "Updated", status: "active", tokenBudget: 250 });
    expect(setThreadGoal).toHaveBeenCalledWith("thread", { status: "paused" });
    expect(clearThreadGoal).toHaveBeenCalledWith("thread");
    expect(addSystemMessage).not.toHaveBeenCalledWith("Goal updated.");
  });

  it("does not mark unavailable or failed goal mutations as committed", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValue({ kind: "not-started" }),
      clearThreadGoal: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
    });

    await expect(commands.setObjective("Stale", null)).resolves.toBe(false);
    await expect(commands.clear("thread")).resolves.toBe(false);
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
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "side" }),
      addSystemMessage,
    });

    await expect(commands.setObjective("Ship", null)).resolves.toBe(false);
    await expect(commands.clear("side")).resolves.toBe(false);

    expect(effects.setThreadGoal).not.toHaveBeenCalled();
    expect(effects.clearThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).toHaveBeenCalledWith("Goals are unavailable in side chats.");
  });

  it("does not report stale goal action failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const update = deferred<never>();
    const effects = effectsFixture({ setThreadGoal: vi.fn().mockReturnValue(update.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
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
    const stateStore = createChatStateStore(state);
    const clear = deferred<never>();
    const effects = effectsFixture({ clearThreadGoal: vi.fn().mockReturnValue(clear.promise) });
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
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
    const stateStore = createChatStateStore(state);
    const effects = effectsFixture();
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage: vi.fn(),
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
      startThread: vi.fn().mockResolvedValue({ kind: "created-activated", threadId: "thread" }),
      addSystemMessage,
    });

    const pending = commands.setObjective("Finish", null);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    connection.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(effects.setThreadGoal).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "edited", "reopened", "failed"] as const)("finishes a save with an %s editor", async (scenario) => {
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
    const saving = deferred<EffectOutcome<void>>();
    const effects = effectsFixture({ setThreadGoal: vi.fn(() => saving.promise) });
    const commands = createGoalCommands({ stateStore, effects, startThread: vi.fn(), addSystemMessage: vi.fn() });
    commands.startEditing("thread", "Draft A", null);
    const pending = commands.saveObjective("Draft A", null);
    await vi.waitFor(() => expect(effects.setThreadGoal).toHaveBeenCalledOnce());
    if (scenario === "edited") commands.updateObjectiveDraft("Draft B");
    if (scenario === "reopened") {
      commands.closeEditor();
      commands.startEditing("thread", "Draft A", null);
    }
    saving.resolve(scenario === "failed" ? { kind: "not-started" } : completed(undefined));
    await pending;
    expect(stateStore.getState().ui.goalEditor).toMatchObject(
      scenario === "unchanged" ? { kind: "closed" } : { kind: "editing", objectiveDraft: scenario === "edited" ? "Draft B" : "Draft A" },
    );
  });

  it("keeps edits through thread creation and a failed save, then closes after retry", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const creation = deferred<EffectOutcome<ThreadActivationSnapshot>>();
    const startEffect = vi.fn(() => creation.promise);
    const starter = createThreadStartCommand({
      stateStore,
      effects: { startThread: startEffect },
      runtimeSnapshotForState: (state) =>
        runtimeSnapshotForChatState(state, {
          runtimeConfigSnapshot: () => null,
          rateLimitsSnapshot: () => null,
          modelsSnapshot: () => [],
        }),
      recordStartedThread: vi.fn(),
    });
    const effects = effectsFixture({
      setThreadGoal: vi.fn().mockResolvedValueOnce({ kind: "not-started" }).mockResolvedValue(completed(undefined)),
    });
    const commands = createGoalCommands({ stateStore, effects, startThread: starter.startThread, addSystemMessage: vi.fn() });
    commands.startEditing(null, "Draft A", null);
    const pending = commands.saveObjective("Draft A", null);
    await vi.waitFor(() => expect(startEffect).toHaveBeenCalledOnce());
    commands.updateObjectiveDraft("Draft B");
    creation.resolve(
      completed({
        thread: {
          id: "thread-new",
          name: null,
          preview: "",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          provenance: { kind: "interactive" },
        },
        canAcceptDirectInput: null,
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: null,
        sandboxPolicy: null,
        activePermissionProfile: null,
      }),
    );
    await expect(pending).resolves.toBe(false);
    expect(activeThreadId(stateStore.getState())).toBe("thread-new");
    expect(stateStore.getState().ui.goalEditor).toMatchObject({ kind: "editing", objectiveDraft: "Draft B" });
    expect(effects.setThreadGoal).toHaveBeenCalledWith("thread-new", { objective: "Draft A", status: "active", tokenBudget: null });
    await expect(commands.saveObjective("Draft B", null)).resolves.toBe(true);
    expect(stateStore.getState().ui.goalEditor.kind).toBe("closed");
    expect(startEffect).toHaveBeenCalledOnce();
  });

  it("does not save a goal through a thread that was created but not activated", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const effects = effectsFixture();
    const addSystemMessage = vi.fn();
    const commands = createGoalCommands({
      stateStore,
      effects,
      startThread: vi.fn().mockResolvedValue({ kind: "created-not-activated" }),
      addSystemMessage,
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
      startThread,
      addSystemMessage: vi.fn(),
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
      setThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
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
      startThread,
      ensureRestoredThreadLoaded,
      addSystemMessage: vi.fn(),
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
      startThread,
      addSystemMessage,
    });

    await expect(commands.saveObjective("   ", null)).resolves.toBe(false);

    expect(addSystemMessage).toHaveBeenCalledWith("Goal objective cannot be empty.");
    expect(ensureConnected).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
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
    setThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
    clearThreadGoal: vi.fn().mockResolvedValue(completed(undefined)),
    ...overrides,
  };
}

function completed<T>(value: T): EffectOutcome<T> {
  return { kind: "completed", value };
}
