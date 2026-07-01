import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import {
  createThreadNavigationActions,
  type ThreadNavigationActionsHost,
} from "../../../../../src/features/chat/application/threads/thread-navigation-actions";

function resumeThreadState(stateStore: ChatStateStore, threadId: string): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: threadId, cliVersion: "test" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function createController(overrides: Partial<ThreadNavigationActionsHost> = {}) {
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
  return { controller: createThreadNavigationActions(host), host, stateStore };
}

describe("ThreadNavigationActions", () => {
  it("starts a blank chat by clearing active thread identity", async () => {
    const { controller, host, stateStore } = createController();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await controller.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(stateStore.getState().connection.statusText).toBe("New chat.");
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores blank chat navigation while a turn is running", async () => {
    const { controller, host, stateStore } = createController();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await controller.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("focuses an already open thread without resuming it", async () => {
    const { controller, host } = createController({
      focusThreadInOpenView: vi.fn().mockResolvedValue(true),
    });

    await controller.selectThread("thread");

    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.focusThreadInOpenView).toHaveBeenCalledWith("thread");
    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("resumes the thread when it is not already open", async () => {
    const { controller, host } = createController();

    await controller.selectThread("thread");

    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it("blocks switching away while a turn is running", async () => {
    const { controller, host, stateStore } = createController();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await controller.selectThread("other");

    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.focusThreadInOpenView).not.toHaveBeenCalled();
    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("closes the toolbar panel before selecting from the toolbar", async () => {
    const { controller, host, stateStore } = createController();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await controller.selectThreadFromToolbar("thread");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it("ignores toolbar selection while another thread is busy", async () => {
    const { controller, host, stateStore } = createController();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await controller.selectThreadFromToolbar("other");

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.resumeThread).not.toHaveBeenCalled();
  });
});
