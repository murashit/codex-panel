import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import type { RestorationController } from "../../../../src/features/chat/threads/restoration-controller";
import { ResumeController } from "../../../../src/features/chat/threads/resume-controller";
import type { HistoryController } from "../../../../src/features/chat/threads/history-controller";
import { ChatResumeWorkTracker } from "../../../../src/features/chat/lifecycle";
import type { Thread as PanelThread } from "../../../../src/domain/threads/model";
import type { ThreadTokenUsage } from "../../../../src/app-server/protocol/runtime-metrics";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";

type ThreadResumeResponse = Awaited<ReturnType<AppServerClient["resumeThread"]>>;

function appServerThread(id: string): ThreadResumeResponse["thread"] {
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
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function activation(threadId: string): ThreadResumeResponse {
  return {
    thread: appServerThread(threadId),
    cwd: "/vault",
    model: "gpt-test",
    modelProvider: "openai",
    serviceTier: null,
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: null,
    initialTurnsPage: null,
  };
}

function createController(
  response: ThreadResumeResponse = activation("thread"),
  overrides: Partial<ConstructorParameters<typeof ResumeController>[0]> = {},
) {
  const stateStore = createChatStateStore(createChatState());
  const resumeThread = vi.fn().mockResolvedValue(response);
  const client = { resumeThread } as unknown as AppServerClient;
  const loadLatest = vi.fn().mockResolvedValue(undefined);
  const applyLatestPage = vi.fn();
  const invalidateHistory = vi.fn();
  const restoredClear = vi.fn();
  const host = {
    stateStore,
    vaultPath: "/vault",
    resumeWork: new ChatResumeWorkTracker(),
    history: { loadLatest, applyLatestPage, invalidate: invalidateHistory } as unknown as HistoryController,
    restoration: { clear: restoredClear } as unknown as RestorationController,
    currentClient: () => client,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    closing: () => false,
    systemItem: (text: string) => ({ id: "system", kind: "system" as const, role: "system" as const, text }),
    resetThreadTurnPresence: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    addSystemMessage: vi.fn(),
    render: vi.fn(),
    refreshLiveState: vi.fn(),
    syncThreadGoal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    controller: new ResumeController(host),
    host,
    applyLatestPage,
    invalidateHistory,
    loadLatest,
    restoredClear,
    resumeThread,
    stateStore,
  };
}

describe("ResumeController", () => {
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

  it("renders after resumed history and goal sync finish", async () => {
    const { controller, host } = createController();

    await controller.resumeThread("thread");

    expect(vi.mocked(host.render).mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      vi.mocked(host.syncThreadGoal).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { controller, host, resumeThread, stateStore } = createController();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("active"),
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
      thread: { ...second.thread, archived: false },
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

function turnFixture(items: TurnItem[]): TurnRecord {
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

function panelThread(id: string): PanelThread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
  };
}

function userMessage(id: string, text: string): TurnItem {
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
