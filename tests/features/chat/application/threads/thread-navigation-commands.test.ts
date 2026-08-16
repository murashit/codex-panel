import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import type {
  PersistentNavigationLifecycle,
  PersistentNavigationPreparation,
} from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import {
  createThreadNavigationCommands,
  type ThreadNavigationCommandsHost,
} from "../../../../../src/features/chat/application/threads/thread-navigation-commands";
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
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function createActionsHarness(overrides: Partial<ThreadNavigationCommandsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const host: ThreadNavigationCommandsHost = {
    stateStore,
    identity: {
      clearActiveThreadIdentity: vi.fn(),
    } as unknown as ActiveThreadIdentitySync,
    closeForThreadSelection: vi.fn(),
    openThreadFromPanel: vi.fn().mockResolvedValue(undefined),
    resumeWork: new ChatResumeWorkTracker(),
    addSystemMessage: vi.fn(),
    focusComposer: vi.fn(),
    navigation: navigationMock(),
    ...overrides,
  };
  return { commands: createThreadNavigationCommands(host), host, stateStore };
}

describe("ThreadNavigationCommands", () => {
  it("starts a blank chat by clearing active thread identity", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await commands.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(stateStore.getState().connection.statusText).toBe("New chat.");
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores blank chat navigation while a turn is running", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("starts a blank chat while a subagent turn continues", async () => {
    const navigation = navigationMock();
    const { commands, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await commands.startNewThread();

    expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null);
    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expectCallBefore(navigation.prepareForPersistentNavigation, host.identity.clearActiveThreadIdentity as ReturnType<typeof vi.fn>);
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("keeps a running subagent active when navigation preparation fails", async () => {
    const navigation = navigationMock(null);
    const { commands, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await commands.startNewThread();

    expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null);
    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("does not commit subagent cleanup when a blank-target intent is superseded before adoption", async () => {
    const prepared = deferred<PersistentNavigationPreparation | null>();
    const navigation = navigationMock();
    navigation.prepareForPersistentNavigation.mockReturnValue(prepared.promise);
    const { commands, host, stateStore } = createActionsHarness({ navigation });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    const startingNew = commands.startNewThread();
    await vi.waitFor(() => expect(navigation.prepareForPersistentNavigation).toHaveBeenCalledWith(null));
    host.resumeWork.begin("child");
    prepared.resolve({ kind: "unsubscribe-on-adoption", threadId: "child" });
    await startingNew;

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(navigation.commitPersistentNavigation).not.toHaveBeenCalled();
  });

  it("allows switching away from a running subagent through workspace coordination", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await commands.selectThread("other");

    expect(host.openThreadFromPanel).toHaveBeenCalledWith("other", true);
  });

  it("blocks switching away while a turn is running", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.selectThread("other");

    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.openThreadFromPanel).not.toHaveBeenCalled();
  });

  it("closes the toolbar panel before selecting from the toolbar", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await commands.selectThreadFromToolbar("thread");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.openThreadFromPanel).toHaveBeenCalledWith("thread", true);
  });

  it("routes toolbar selection away from a busy origin panel", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.selectThreadFromToolbar("other");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.openThreadFromPanel).toHaveBeenCalledWith("other", false);
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
