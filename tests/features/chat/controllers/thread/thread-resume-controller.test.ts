import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import type { RestoredThreadController } from "../../../../../src/features/chat/controllers/thread/restored-thread-controller";
import type { ThreadActivationResponse } from "../../../../../src/features/chat/thread-resume";
import { ThreadResumeController } from "../../../../../src/features/chat/controllers/thread/thread-resume-controller";
import type { ThreadHistoryController } from "../../../../../src/features/chat/controllers/thread/thread-history-controller";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/panel/lifecycle";
import type { ThreadItem } from "../../../../../src/generated/app-server/v2/ThreadItem";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";
import type { ThreadTokenUsage } from "../../../../../src/generated/app-server/v2/ThreadTokenUsage";
import type { Turn } from "../../../../../src/generated/app-server/v2/Turn";

function thread(id: string): Thread {
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

function createController(
  response: ThreadActivationResponse = activation("thread"),
  overrides: Partial<ConstructorParameters<typeof ThreadResumeController>[0]> = {},
) {
  const stateStore = createChatStateStore(createChatState());
  const resumeThread = vi.fn().mockResolvedValue(response);
  const client = { resumeThread } as unknown as AppServerClient;
  const loadLatest = vi.fn().mockResolvedValue(undefined);
  const applyLatestPage = vi.fn();
  const restoredClear = vi.fn();
  const host = {
    stateStore,
    vaultPath: "/vault",
    resumeWork: new ChatResumeWorkTracker(() => undefined),
    history: { loadLatest, applyLatestPage } as unknown as ThreadHistoryController,
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
    syncThreadGoal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { controller: new ThreadResumeController(host), host, applyLatestPage, loadLatest, restoredClear, resumeThread, stateStore };
}

describe("ThreadResumeController", () => {
  it("resumes the thread and loads its latest history", async () => {
    const { controller, host, loadLatest, restoredClear, resumeThread, stateStore } = createController();

    await controller.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith("thread", "/vault");
    expect(host.syncThreadGoal).toHaveBeenCalledWith("thread");
    expect(stateStore.getState().activeThread.id).toBe("thread");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(restoredClear).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("hydrates resumed threads from the initial turns page when app-server returns one", async () => {
    const response = {
      ...activation("thread"),
      initialTurnsPage: {
        data: [turnFixture([userMessage("u1", "hello")])],
        nextCursor: "older",
        backwardsCursor: null,
      },
    };
    const { controller, applyLatestPage, loadLatest } = createController(response);

    await controller.resumeThread("thread");

    expect(applyLatestPage).toHaveBeenCalledWith("thread", response.initialTurnsPage);
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { controller, host, resumeThread, stateStore } = createController();
    stateStore.dispatch({
      type: "active-thread/resumed",
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

  it("recovers rollout token usage without blocking latest history loading", async () => {
    const response = activation("thread");
    response.thread.path = "/tmp/rollout.jsonl";
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { controller, loadLatest, stateStore } = createController(response, { recoverTokenUsageFromRollout });

    await controller.resumeThread("thread");

    expect(recoverTokenUsageFromRollout).toHaveBeenCalledWith("/tmp/rollout.jsonl");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.tokenUsage).toMatchObject({ last: { inputTokens: 42 } });
  });

  it("ignores stale rollout token usage recovery", async () => {
    const first = activation("thread");
    first.thread.path = "/tmp/thread.jsonl";
    const second = activation("other");
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { controller, stateStore } = createController(first, { recoverTokenUsageFromRollout });

    await controller.resumeThread("thread");
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: second.thread,
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.id).toBe("other");
    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();
  });

  it("does not let late rollout token usage recovery overwrite live token usage", async () => {
    const response = activation("thread");
    response.thread.path = "/tmp/rollout.jsonl";
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { controller, stateStore } = createController(response, { recoverTokenUsageFromRollout });

    await controller.resumeThread("thread");
    stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage: tokenUsageFixture(99) });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.tokenUsage).toMatchObject({ last: { inputTokens: 99 } });
  });

  it("ignores rollout token usage recovery failures", async () => {
    const response = activation("thread");
    response.thread.path = "/tmp/rollout.jsonl";
    const recoverTokenUsageFromRollout = vi.fn().mockRejectedValue(new Error("read failed"));
    const { controller, host, stateStore } = createController(response, { recoverTokenUsageFromRollout });

    await controller.resumeThread("thread");
    await Promise.resolve();

    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("read failed");
  });
});

function turnFixture(items: ThreadItem[]): Turn {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
  };
}

function userMessage(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function tokenUsageFixture(inputTokens: number): ThreadTokenUsage {
  return {
    last: { inputTokens, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: inputTokens + 2 },
    total: { inputTokens, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: inputTokens + 2 },
    modelContextWindow: 1000,
  };
}

function deferred<T>(): { promise: Promise<T>; resolveAndFlush: (value: T) => Promise<void> } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    async resolveAndFlush(value) {
      resolve(value);
      await Promise.resolve();
    },
  };
}
