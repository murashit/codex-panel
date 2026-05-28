import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore, type ChatStateStore } from "../../../src/features/chat/chat-state";
import { ThreadSelectionController, type ThreadSelectionControllerHost } from "../../../src/features/chat/thread-selection-controller";

function resumeThreadState(stateStore: ChatStateStore, threadId: string): void {
  stateStore.dispatch({
    type: "thread/resumed",
    thread: { id: threadId, cliVersion: "test" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalPolicy: null,
    approvalsReviewer: null,
    activePermissionProfile: null,
  });
}

function createController(overrides: Partial<ThreadSelectionControllerHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const host: ThreadSelectionControllerHost = {
    stateStore,
    closeForThreadSelection: vi.fn(),
    focusThreadInOpenView: vi.fn().mockResolvedValue(false),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { controller: new ThreadSelectionController(host), host, stateStore };
}

describe("ThreadSelectionController", () => {
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
});
