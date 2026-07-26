import { describe, expect, it, vi } from "vitest";

import type { ThreadTokenUsage } from "../../../../../src/domain/runtime/metrics";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import { activeThreadId, activeThreadState, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { HistoryController, ThreadHistoryPage } from "../../../../../src/features/chat/application/threads/history-controller";
import {
  createResumeCommand,
  type ResumeCommandHost,
  type ThreadResumeEffects,
  type ThreadResumeSnapshot,
} from "../../../../../src/features/chat/application/threads/resume-command";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

function activation(threadId: string, overrides: Partial<ThreadResumeSnapshot> = {}): ThreadResumeSnapshot {
  return {
    activation: {
      thread: panelThread(threadId),
      model: "gpt-test",
      serviceTier: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalsReviewer: "user",
      reasoningEffort: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
    },
    rolloutPath: null,
    initialHistoryPage: null,
    ...overrides,
  };
}

function createActions(response: ThreadResumeSnapshot | null = activation("thread"), overrides: Partial<ResumeCommandHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const resumeThread = vi
    .fn<ThreadResumeEffects["resumeThread"]>()
    .mockResolvedValue(response ? { kind: "completed-current", value: response } : { kind: "not-started" });
  const loadLatest = vi.fn().mockResolvedValue(undefined);
  const applyLatestPage = vi.fn();
  const invalidateHistory = vi.fn();
  const host: ResumeCommandHost & { systemItem: (text: string) => ThreadStreamItem } = {
    stateStore,
    resumeWork: new ChatResumeWorkTracker(),
    history: { loadLatest, applyLatestPage, invalidate: invalidateHistory } as unknown as HistoryController,
    closing: () => false,
    systemItem: (text: string) => ({ id: "system", kind: "system" as const, role: "system" as const, text }),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    recordResumedThread: vi.fn(),
    addSystemMessage: vi.fn(),
    syncThreadGoal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
    effects: overrides.effects ?? { resumeThread },
    ensureConnected: overrides.ensureConnected ?? vi.fn().mockResolvedValue(true),
  };
  return {
    commands: createResumeCommand(host),
    host,
    applyLatestPage,
    invalidateHistory,
    loadLatest,
    resumeThread,
    stateStore,
  };
}

describe("ResumeCommand", () => {
  it("resumes the thread and loads its latest history", async () => {
    const { commands, host, loadLatest, resumeThread, stateStore } = createActions();

    await commands.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith("thread");
    expect(host.syncThreadGoal).toHaveBeenCalledWith("thread");
    expect(activeThreadId(stateStore.getState())).toBe("thread");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.recordResumedThread).toHaveBeenCalledWith(panelThread("thread"));
  });

  it("hydrates resumed threads from the initial turns page when app-server returns one", async () => {
    const initialHistoryPage = historyPage([message("u1", "hello", "user")], "older");
    const response = activation("thread", { initialHistoryPage });
    const { commands, applyLatestPage, loadLatest } = createActions(response);

    await commands.resumeThread("thread");

    expect(applyLatestPage).toHaveBeenCalledWith("thread", initialHistoryPage);
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("commits target adoption before waiting for history hydration", async () => {
    const history = deferred<void>();
    const onAdopted = vi.fn();
    const { commands, loadLatest } = createActions(undefined, {
      history: {
        loadLatest: vi.fn(() => history.promise),
        applyLatestPage: vi.fn(),
        invalidate: vi.fn(),
      } as unknown as HistoryController,
    });

    const resuming = commands.resumeThread("thread", undefined, { onAdopted });
    await vi.waitFor(() => expect(onAdopted).toHaveBeenCalledOnce());

    expect(loadLatest).not.toHaveBeenCalled();
    history.resolveAndFlush(undefined);
    await expect(resuming).resolves.toBe(true);
  });

  it("announces target adoption only when resume changes the panel target", async () => {
    const sameTarget = createActions(activation("thread"));
    sameTarget.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("thread"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const sameTargetBeforeActivate = vi.fn();

    await sameTarget.commands.resumeThread("thread", undefined, { beforeActivate: sameTargetBeforeActivate });

    expect(sameTargetBeforeActivate).not.toHaveBeenCalled();

    const differentTarget = createActions(activation("other"));
    const differentTargetBeforeActivate = vi.fn();

    await differentTarget.commands.resumeThread("other", undefined, { beforeActivate: differentTargetBeforeActivate });

    expect(differentTargetBeforeActivate).toHaveBeenCalledOnce();
  });

  it("does not change active thread when the resume port has no snapshot", async () => {
    const { commands, host, loadLatest, resumeThread, stateStore } = createActions(null);

    await commands.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith("thread");
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(loadLatest).not.toHaveBeenCalled();
    expect(host.syncThreadGoal).not.toHaveBeenCalled();
  });

  it("does not invoke an older resume after a newer intent wins during connection", async () => {
    const firstConnection = deferred<boolean>();
    const resumeThread = vi.fn<ThreadResumeEffects["resumeThread"]>().mockImplementation(async (threadId) => ({
      kind: "completed-current",
      value: activation(threadId),
    }));
    const ensureConnected = vi.fn().mockReturnValueOnce(firstConnection.promise).mockResolvedValue(true);
    const { commands, stateStore } = createActions(undefined, {
      effects: { resumeThread },
      ensureConnected,
    });

    const firstResume = commands.resumeThread("first");
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    await expect(commands.resumeThread("second")).resolves.toBe(true);
    await firstConnection.resolveAndFlush(true);
    await expect(firstResume).resolves.toBe(false);

    expect(resumeThread).toHaveBeenCalledOnce();
    expect(resumeThread).toHaveBeenCalledWith("second");
    expect(activeThreadId(stateStore.getState())).toBe("second");
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { commands, host, resumeThread, stateStore } = createActions();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("active"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.resumeThread("other");

    expect(resumeThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
  });

  it("recovers rollout token usage without blocking latest history loading", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { commands, loadLatest, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await commands.resumeThread("thread");

    expect(recoverTokenUsageFromRollout).toHaveBeenCalledWith("/tmp/rollout.jsonl");
    expect(loadLatest).toHaveBeenCalledWith("thread");
    expect(activeThreadState(stateStore.getState())?.tokenUsage).toBeNull();

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(activeThreadState(stateStore.getState())?.tokenUsage).toMatchObject({ last: { inputTokens: 42 } });
  });

  it("ignores stale rollout token usage recovery", async () => {
    const first = activation("thread", { rolloutPath: "/tmp/thread.jsonl" });
    const second = activation("other");
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { commands, stateStore } = createActions(first, { recoverTokenUsageFromRollout });

    await commands.resumeThread("thread");
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: second.activation.thread,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(activeThreadId(stateStore.getState())).toBe("other");
    expect(activeThreadState(stateStore.getState())?.tokenUsage).toBeNull();
  });

  it("does not let late rollout token usage recovery overwrite live token usage", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recovery = deferred<ThreadTokenUsage | null>();
    const recoverTokenUsageFromRollout = vi.fn().mockReturnValue(recovery.promise);
    const { commands, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await commands.resumeThread("thread");
    stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage: tokenUsageFixture(99) });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(activeThreadState(stateStore.getState())?.tokenUsage).toMatchObject({ last: { inputTokens: 99 } });
  });

  it("ignores rollout token usage recovery failures", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recoverTokenUsageFromRollout = vi.fn().mockRejectedValue(new Error("read failed"));
    const { commands, host, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await commands.resumeThread("thread");
    await Promise.resolve();

    expect(activeThreadState(stateStore.getState())?.tokenUsage).toBeNull();
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
    provenance: { kind: "interactive" },
  };
}

function historyPage(items: ThreadStreamItem[], nextCursor: string | null): ThreadHistoryPage {
  return { items, nextCursor, hadTurns: items.length > 0 };
}

function message(id: string, text: string, role: "assistant" | "user"): ThreadStreamItem {
  return role === "user"
    ? { id, kind: "dialogue", role, text, dialogueKind: "user", turnId: "turn" }
    : { id, kind: "dialogue", role, text, dialogueKind: "assistantResponse", dialogueState: "completed", turnId: "turn" };
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
