import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import {
  createThreadNavigationActions,
  type ThreadNavigationActionsHost,
} from "../../../../../src/features/chat/application/threads/thread-navigation-actions";

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
    resumeThread: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    focusComposer: vi.fn(),
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
    const { actions, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await actions.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expect(host.focusComposer).toHaveBeenCalledOnce();
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

  it("resumes the thread when it is not already open", async () => {
    const { actions, host } = createActionsHarness();

    await actions.selectThread("thread");

    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
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
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
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
