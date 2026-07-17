import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import type {
  PersistentNavigationLifecycle,
  PersistentNavigationPreparation,
} from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";
import { createPersistentNavigationLifecycle } from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import {
  createThreadNavigationActions,
  type ThreadNavigationActionsHost,
} from "../../../../../src/features/chat/application/threads/thread-navigation-actions";
import { deferred } from "../../../../support/async";

function resumeThreadState(stateStore: ChatStateStore, threadId: string, subagent = false): void {
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
      cliVersion: "test",
      provenance: subagent
        ? {
            kind: "subagent",
            subagentKind: "thread-spawn",
            parentThreadId: "parent",
            sessionId: "session",
            depth: 1,
            agentNickname: "Scout",
            agentRole: "explorer",
          }
        : { kind: "interactive" },
    } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function createActionsHarness(overrides: Partial<ThreadNavigationActionsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const host: ThreadNavigationActionsHost = {
    stateStore,
    identity: {
      clearActiveThreadIdentity: vi.fn(),
    } as unknown as ActiveThreadIdentitySync,
    closeForThreadSelection: vi.fn(),
    focusThreadInOpenView: vi.fn().mockResolvedValue(false),
    resumeThread: vi.fn().mockResolvedValue(true),
    resumeWork: new ChatResumeWorkTracker(),
    addSystemMessage: vi.fn(),
    focusComposer: vi.fn(),
    navigation: navigationMock(),
    ...overrides,
  };
  return { actions: createThreadNavigationActions(host), host, stateStore };
}

describe("ThreadNavigationActions", () => {
  it("starts a blank chat by clearing active thread identity", async () => {
    const { actions, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await actions.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expect(host.navigation.commitPersistentNavigation).toHaveBeenCalledWith({ kind: "ready" });
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(stateStore.getState().connection.statusText).toBe("New chat.");
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores blank chat navigation while a turn is running", async () => {
    const { actions, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await actions.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("starts a blank chat while a subagent turn continues", async () => {
    const navigation = navigationMock();
    const { actions, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await actions.startNewThread();

    expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null);
    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expectCallBefore(navigation.prepareForPersistentNavigation, host.identity.clearActiveThreadIdentity as ReturnType<typeof vi.fn>);
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("keeps a running subagent active when unsubscribe preparation fails", async () => {
    const navigation = navigationMock(null);
    const { actions, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await actions.startNewThread();

    expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null);
    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("does not commit subagent cleanup when a blank-target intent is superseded before adoption", async () => {
    const prepared = deferred<PersistentNavigationPreparation | null>();
    const navigation = navigationMock();
    navigation.prepareForPersistentNavigation.mockReturnValue(prepared.promise);
    const { actions, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    const startingNew = actions.startNewThread();
    await vi.waitFor(() => expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null));
    host.resumeWork.begin("child");
    prepared.resolve({ kind: "unsubscribe-on-adoption", threadId: "child" });
    await startingNew;

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(navigation.commitPersistentNavigation).not.toHaveBeenCalled();
  });

  it("focuses an already open thread without resuming it", async () => {
    const { actions, host } = createActionsHarness({
      focusThreadInOpenView: vi.fn().mockResolvedValue(true),
    });

    await actions.selectThread("thread");

    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.focusThreadInOpenView).toHaveBeenCalledWith("thread");
    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("keeps a running subagent subscribed when the selected thread is already open elsewhere", async () => {
    const navigation = navigationMock();
    const { actions, host, stateStore } = createActionsHarness({
      navigation,
      focusThreadInOpenView: vi.fn().mockResolvedValue(true),
    });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await actions.selectThread("other");

    expect(host.focusThreadInOpenView).toHaveBeenCalledWith("other");
    expect(navigation.prepareForPersistentNavigation).not.toHaveBeenCalled();
    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("resumes the thread when it is not already open", async () => {
    const { actions, host } = createActionsHarness();

    await actions.selectThread("thread");

    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith(
      "thread",
      expect.objectContaining({ threadId: "thread" }),
      expect.objectContaining({ onAdopted: expect.any(Function) }),
    );
  });

  it("does not resume an older selection after a newer selection wins during view lookup", async () => {
    const firstLookup = deferred<boolean>();
    const focusThreadInOpenView = vi.fn((threadId: string) => (threadId === "first" ? firstLookup.promise : Promise.resolve(false)));
    const { actions, host } = createActionsHarness({ focusThreadInOpenView });

    const firstSelection = actions.selectThread("first");
    await vi.waitFor(() => expect(focusThreadInOpenView).toHaveBeenCalledWith("first"));
    await actions.selectThread("second");
    firstLookup.resolve(false);
    await firstSelection;

    expect(host.resumeThread).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith(
      "second",
      expect.objectContaining({ threadId: "second" }),
      expect.objectContaining({ onAdopted: expect.any(Function) }),
    );
  });

  it("allows switching away from a running subagent after unsubscribe preparation", async () => {
    const preparation = { kind: "unsubscribe-on-adoption", threadId: "child" } as const;
    const navigation = navigationMock(preparation);
    const resumeThread = vi.fn(async (_threadId, _intent, options) => {
      options?.onAdopted?.();
      return true;
    });
    const { actions, host, stateStore } = createActionsHarness({ navigation, resumeThread });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await actions.selectThread("other");

    expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith("other");
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith(
      "other",
      expect.objectContaining({ threadId: "other" }),
      expect.objectContaining({ onAdopted: expect.any(Function) }),
    );
    expect(navigation.commitPersistentNavigation).toHaveBeenCalledWith(preparation);
  });

  it("keeps the old subagent cleanup committed when a newer selection arrives during resumed history", async () => {
    const stateStore = createChatStateStore(createChatState());
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });
    const unsubscribeThread = vi.fn().mockResolvedValue(true);
    const navigation = createPersistentNavigationLifecycle({
      stateStore,
      subscriptions: { unsubscribeThread },
      ephemeral: {
        open: vi.fn(),
        prepareForPersistentNavigation: vi.fn().mockResolvedValue(true),
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      addSystemMessage: vi.fn(),
    });
    const history = deferred<void>();
    const resumeThread = vi.fn(async (threadId, _intent, options) => {
      resumeThreadState(stateStore, threadId);
      options?.onAdopted?.();
      if (threadId === "first") await history.promise;
      return true;
    });
    const { actions } = createActionsHarness({ stateStore, navigation, resumeThread });

    const firstSelection = actions.selectThread("first");
    await vi.waitFor(() => expect(unsubscribeThread).toHaveBeenCalledWith("child"));
    await actions.selectThread("second");
    history.resolve(undefined);
    await firstSelection;

    expect(unsubscribeThread).toHaveBeenCalledOnce();
  });

  it("blocks switching away while a turn is running", async () => {
    const { actions, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await actions.selectThread("other");

    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.focusThreadInOpenView).not.toHaveBeenCalled();
    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("closes the toolbar panel before selecting from the toolbar", async () => {
    const { actions, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await actions.selectThreadFromToolbar("thread");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith(
      "thread",
      expect.objectContaining({ threadId: "thread" }),
      expect.objectContaining({ onAdopted: expect.any(Function) }),
    );
  });

  it("ignores toolbar selection while another thread is busy", async () => {
    const { actions, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await actions.selectThreadFromToolbar("other");

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.resumeThread).not.toHaveBeenCalled();
  });
});

function expectCallBefore(first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>): void {
  const firstCall = first.mock.invocationCallOrder[0];
  const secondCall = second.mock.invocationCallOrder[0];
  if (firstCall === undefined || secondCall === undefined) throw new Error("Expected both mocks to have been called.");
  expect(firstCall).toBeLessThan(secondCall);
}

function navigationMock(preparation: PersistentNavigationPreparation | null = { kind: "ready" }): PersistentNavigationLifecycle & {
  prepareForPersistentNavigation: ReturnType<typeof vi.fn>;
  commitPersistentNavigation: ReturnType<typeof vi.fn>;
} {
  return {
    prepareForPersistentNavigation: vi.fn().mockResolvedValue(preparation),
    commitPersistentNavigation: vi.fn((_preparation: PersistentNavigationPreparation): void => undefined),
  };
}
