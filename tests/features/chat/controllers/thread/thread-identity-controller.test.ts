import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import { ThreadIdentityController } from "../../../../../src/features/chat/controllers/thread/thread-identity-controller";
import type { RestoredThreadController } from "../../../../../src/features/chat/controllers/thread/restored-thread-controller";
import type { RestoredThreadPlaceholderState } from "../../../../../src/features/chat/panel/lifecycle";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";

function thread(id: string, name: string | null = null): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "test",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}

function createController() {
  const stateStore = createChatStateStore(createChatState());
  const restoredPlaceholder = vi.fn<() => RestoredThreadPlaceholderState | null>(() => null);
  const restoredRename = vi.fn();
  const restoredThread = {
    clear: vi.fn(),
    isPending: vi.fn(() => false),
    placeholder: restoredPlaceholder,
    rename: restoredRename,
  } as unknown as RestoredThreadController;
  const host = {
    stateStore,
    restoredThread,
    invalidateResumeWork: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshTabHeader: vi.fn(),
    refreshLiveState: vi.fn(),
    render: vi.fn(),
  };
  return { controller: new ThreadIdentityController(host), host, restoredPlaceholder, restoredRename, stateStore };
}

describe("ThreadIdentityController", () => {
  it("clears the active thread when it is archived", () => {
    const { controller, host, stateStore } = createController();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    controller.notifyThreadArchived("thread");

    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
  });

  it("updates listed and restored thread titles on rename notifications", () => {
    const { controller, host, restoredPlaceholder, restoredRename, stateStore } = createController();
    stateStore.dispatch({ type: "thread-list/applied", threads: [thread("thread", "Old")] });
    restoredPlaceholder.mockReturnValue({
      kind: "placeholder",
      threadId: "thread",
      title: "Old",
      explicitName: "Old",
      loading: null,
    });

    controller.notifyThreadRenamed("thread", "New");

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("New");
    expect(restoredRename).toHaveBeenCalledWith("thread", "New");
    expect(host.render).toHaveBeenCalledOnce();
  });
});
