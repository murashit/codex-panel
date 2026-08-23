import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { activeThreadId, activeThreadState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadGoalSync as createThreadGoalSyncImpl,
  type ThreadGoalSource,
} from "../../../../../src/features/chat/application/threads/goal-sync";
import { createThreadGoalCoordinator } from "../../../../../src/features/threads/workflows/thread-goal-coordinator";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

function createThreadGoalSync(
  host: Parameters<typeof createThreadGoalSyncImpl>[0],
  coordinator: Parameters<typeof createThreadGoalSyncImpl>[1] = createThreadGoalCoordinator(),
) {
  return createThreadGoalSyncImpl(host, coordinator);
}

describe("createThreadGoalSync", () => {
  it("syncs the active thread goal into chat state", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const currentGoal = goal();
    const source = goalReadPortFixture({ readThreadGoal: vi.fn().mockResolvedValue(currentGoal) });
    const addSystemMessage = vi.fn();
    const addGoalEvent = vi.fn();
    const sync = createThreadGoalSync({
      stateStore,
      source,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      addSystemMessage,
      addGoalEvent,
    });

    await sync.syncThreadGoal("thread");

    expect(activeThreadState(stateStore.getState())?.goal).toEqual(currentGoal);
    expect(addSystemMessage).not.toHaveBeenCalled();
    expect(addGoalEvent).not.toHaveBeenCalled();
  });

  it("does not publish an old goal read after a shared mutation completes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread", goal: goal({ objective: "Latest" }) } });
    const stateStore = createChatStateStore(state);
    const oldRead = deferred<ThreadGoal | null>();
    const source = goalReadPortFixture({ readThreadGoal: vi.fn(() => oldRead.promise) });
    const goalCoordinator = createThreadGoalCoordinator();
    const sync = createThreadGoalSync(
      {
        stateStore,
        source,
        localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
        addSystemMessage: vi.fn(),
        addGoalEvent: vi.fn(),
      },
      goalCoordinator,
    );

    const reading = sync.syncThreadGoal("thread");
    await vi.waitFor(() => expect(source.readThreadGoal).toHaveBeenCalledOnce());
    goalCoordinator.markAuthoritativeObservation("thread");
    oldRead.resolve(goal({ objective: "Old" }));
    await reading;

    expect(activeThreadState(stateStore.getState())?.goal?.objective).toBe("Latest");
  });

  it("does not let an earlier visit overwrite a newer goal sync after returning to the thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    resumeThread(stateStore, "thread");
    const earlierRead = deferred<ThreadGoal | null>();
    const currentRead = deferred<ThreadGoal | null>();
    const source = goalReadPortFixture({
      readThreadGoal: vi.fn().mockReturnValueOnce(earlierRead.promise).mockReturnValueOnce(currentRead.promise),
    });
    const sync = createThreadGoalSync({
      stateStore,
      source,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      addSystemMessage: vi.fn(),
      addGoalEvent: vi.fn(),
    });

    const earlierSync = sync.syncThreadGoal("thread");
    resumeThread(stateStore, "other");
    resumeThread(stateStore, "thread");
    const currentSync = sync.syncThreadGoal("thread");

    currentRead.resolve(goal({ objective: "Current" }));
    await currentSync;
    earlierRead.resolve(goal({ objective: "Earlier" }));
    await earlierSync;

    expect(activeThreadState(stateStore.getState())?.goal?.objective).toBe("Current");
  });

  it("does not report an old goal read failure after a shared mutation completes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread", goal: goal({ objective: "Latest" }) } });
    const stateStore = createChatStateStore(state);
    const oldRead = deferred<ThreadGoal | null>();
    const source = goalReadPortFixture({ readThreadGoal: vi.fn(() => oldRead.promise) });
    const addSystemMessage = vi.fn();
    const goalCoordinator = createThreadGoalCoordinator();
    const sync = createThreadGoalSync(
      {
        stateStore,
        source,
        localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
        addSystemMessage,
        addGoalEvent: vi.fn(),
      },
      goalCoordinator,
    );

    const reading = sync.syncThreadGoal("thread");
    await vi.waitFor(() => expect(source.readThreadGoal).toHaveBeenCalledOnce());
    goalCoordinator.markAuthoritativeObservation("thread");
    oldRead.reject(new Error("old read failed"));
    await reading;

    expect(addSystemMessage).not.toHaveBeenCalledWith("Could not load thread goal: old read failed");
  });

  it("reports goal sync failures without clearing the active thread", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const stateStore = createChatStateStore(state);
    const addSystemMessage = vi.fn();
    const source = goalReadPortFixture({ readThreadGoal: vi.fn().mockRejectedValue(new Error("offline")) });
    const sync = createThreadGoalSync({
      stateStore,
      source,
      localItemIds: createLocalIdSource({ nowMs: () => 1, seed: "goal" }),
      addSystemMessage,
      addGoalEvent: vi.fn(),
    });

    await sync.syncThreadGoal("thread");

    expect(activeThreadId(stateStore.getState())).toBe("thread");
    expect(activeThreadState(stateStore.getState())?.goal).toBeNull();
    expect(addSystemMessage).toHaveBeenCalledWith("Could not load thread goal: offline");
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

function goalReadPortFixture(overrides: Partial<ThreadGoalSource> = {}): ThreadGoalSource {
  return {
    readThreadGoal: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function resumeThread(stateStore: ReturnType<typeof createChatStateStore>, threadId: string): void {
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
      id: threadId,
      preview: "",
      name: null,
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
