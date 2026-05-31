import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import type { RestoredThreadController } from "../../../../../src/features/chat/controllers/thread/restored-thread-controller";
import { createThreadLifecycleStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import type { ThreadActivationResponse } from "../../../../../src/features/chat/thread-resume";
import { ThreadResumeController } from "../../../../../src/features/chat/controllers/thread/thread-resume-controller";
import type { ThreadHistoryLoader } from "../../../../../src/features/chat/thread-history";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/view-lifecycle";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";

function thread(id: string): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
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
    name: null,
    turns: [],
  };
}

function activation(threadId: string): ThreadActivationResponse {
  return {
    thread: thread(threadId),
    cwd: "/vault",
    model: "gpt-test",
    serviceTier: null,
    approvalPolicy: null,
    approvalsReviewer: null,
    activePermissionProfile: null,
    reasoningEffort: null,
  };
}

function createController() {
  const stateStore = createChatStateStore(createChatState());
  const resumeThread = vi.fn().mockResolvedValue(activation("thread"));
  const client = { resumeThread } as unknown as AppServerClient;
  const loadLatest = vi.fn().mockResolvedValue(undefined);
  const restoredClear = vi.fn();
  const host = {
    state: createThreadLifecycleStatePort(stateStore),
    vaultPath: "/vault",
    resumeWork: new ChatResumeWorkTracker(() => undefined),
    history: { loadLatest } as unknown as ThreadHistoryLoader,
    restoredThread: { clear: restoredClear } as unknown as RestoredThreadController,
    currentClient: () => client,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    closing: () => false,
    systemItem: (text: string) => ({ id: "system", kind: "system" as const, role: "system" as const, text }),
    resetThreadTurnPresence: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    addSystemMessage: vi.fn(),
    forceMessagesToBottom: vi.fn(),
    render: vi.fn(),
    refreshLiveState: vi.fn(),
  };
  return { controller: new ThreadResumeController(host), host, loadLatest, restoredClear, resumeThread, stateStore };
}

describe("ThreadResumeController", () => {
  it("resumes the thread and loads its latest history", async () => {
    const { controller, host, loadLatest, restoredClear, resumeThread, stateStore } = createController();

    await controller.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith("thread", "/vault");
    expect(stateStore.getState().activeThreadId).toBe("thread");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(restoredClear).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { controller, host, resumeThread, stateStore } = createController();
    stateStore.dispatch({
      type: "thread/resumed",
      thread: thread("active"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await controller.resumeThread("other");

    expect(resumeThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
  });
});
