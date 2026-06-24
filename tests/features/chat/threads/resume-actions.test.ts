import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ThreadTokenUsage } from "../../../../src/domain/runtime/metrics";
import type { Thread as PanelThread } from "../../../../src/domain/threads/model";
import type { ChatThreadHistoryPage, ChatThreadResumeSnapshot } from "../../../../src/features/chat/app-server/threads/projection";
import { ChatResumeWorkTracker } from "../../../../src/features/chat/application/lifecycle";
import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { HistoryController } from "../../../../src/features/chat/application/threads/history-controller";
import type { RestorationController } from "../../../../src/features/chat/application/threads/restoration-controller";
import { createResumeActions, type ResumeActionsHost } from "../../../../src/features/chat/application/threads/resume-actions";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";

function activation(threadId: string, overrides: Partial<ChatThreadResumeSnapshot> = {}): ChatThreadResumeSnapshot {
  return {
    activation: {
      thread: panelThread(threadId),
      cwd: "/vault",
      model: "gpt-test",
      serviceTier: null,
      approvalsReviewer: "user",
      reasoningEffort: null,
    },
    rolloutPath: null,
    initialHistoryPage: null,
    ...overrides,
  };
}

function createActions(response: ChatThreadResumeSnapshot = activation("thread"), overrides: Partial<ResumeActionsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const resumeFromAppServer = vi.fn().mockResolvedValue(response);
  const client = {} as AppServerClient;
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
    notifyActiveThreadIdentityChanged: vi.fn(),
    addSystemMessage: vi.fn(),
    refreshLiveState: vi.fn(),
    syncThreadGoal: vi.fn().mockResolvedValue(undefined),
    resumeFromAppServer,
    ...overrides,
  };
  return {
    actions: createResumeActions(host),
    host,
    applyLatestPage,
    invalidateHistory,
    loadLatest,
    restoredClear,
    resumeThread: resumeFromAppServer,
    stateStore,
  };
}

describe("ResumeActions", () => {
  it("resumes the thread and loads its latest history", async () => {
    const { actions, host, loadLatest, restoredClear, resumeThread, stateStore } = createActions();

    await actions.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith(expect.anything(), "thread", "/vault");
    expect(host.syncThreadGoal).toHaveBeenCalledWith("thread");
    expect(stateStore.getState().activeThread.id).toBe("thread");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(restoredClear).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("hydrates resumed threads from the initial turns page when app-server returns one", async () => {
    const initialHistoryPage = historyPage([message("u1", "hello", "user")], "older");
    const response = activation("thread", { initialHistoryPage });
    const { actions, applyLatestPage, loadLatest } = createActions(response);

    await actions.resumeThread("thread");

    expect(applyLatestPage).toHaveBeenCalledWith("thread", initialHistoryPage);
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("refreshes live state after resumed history and goal sync finish", async () => {
    const { actions, host } = createActions();

    await actions.resumeThread("thread");

    expect(vi.mocked(host.refreshLiveState).mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      vi.mocked(host.syncThreadGoal).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { actions, host, resumeThread, stateStore } = createActions();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("active"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await actions.resumeThread("other");

    expect(resumeThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
  });

  it("recovers rollout token usage without blocking latest history loading", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { actions, loadLatest, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await actions.resumeThread("thread");

    expect(recoverTokenUsageFromRollout).toHaveBeenCalledWith("/tmp/rollout.jsonl");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.tokenUsage).toMatchObject({ last: { inputTokens: 42 } });
  });

  it("ignores stale rollout token usage recovery", async () => {
    const first = activation("thread", { rolloutPath: "/tmp/thread.jsonl" });
    const second = activation("other");
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { actions, stateStore } = createActions(first, { recoverTokenUsageFromRollout });

    await actions.resumeThread("thread");
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: second.activation.thread,
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.id).toBe("other");
    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();
  });

  it("does not let late rollout token usage recovery overwrite live token usage", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { actions, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await actions.resumeThread("thread");
    stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage: tokenUsageFixture(99) });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(stateStore.getState().activeThread.tokenUsage).toMatchObject({ last: { inputTokens: 99 } });
  });

  it("ignores rollout token usage recovery failures", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recoverTokenUsageFromRollout = vi.fn().mockRejectedValue(new Error("read failed"));
    const { actions, host, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await actions.resumeThread("thread");
    await Promise.resolve();

    expect(stateStore.getState().activeThread.tokenUsage).toBeNull();
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("read failed");
  });
});

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

function historyPage(items: MessageStreamItem[], nextCursor: string | null): ChatThreadHistoryPage {
  return { items, nextCursor, hadTurns: items.length > 0 };
}

function message(id: string, text: string, role: "assistant" | "user"): MessageStreamItem {
  return role === "user"
    ? { id, kind: "message", role, text, messageKind: "user", turnId: "turn" }
    : { id, kind: "message", role, text, messageKind: "assistantResponse", messageState: "completed", turnId: "turn" };
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
