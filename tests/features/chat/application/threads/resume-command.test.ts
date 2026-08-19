import { describe, expect, it, vi } from "vitest";

import type { ThreadTokenUsage } from "../../../../../src/domain/runtime/metrics";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import { activeThreadId, activeThreadState, createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatThreadStreamViewState } from "../../../../../src/features/chat/application/state/turn-scope";
import { HistoryController, type ThreadHistoryPage } from "../../../../../src/features/chat/application/threads/history-controller";
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
    .mockResolvedValue(response ? { kind: "completed", value: response } : { kind: "not-started" });
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

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();

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

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();

    expect(applyLatestPage).toHaveBeenCalledWith("thread", initialHistoryPage);
    expect(loadLatest).not.toHaveBeenCalled();
  });

  it("hydrates a fork from app-server history without dropping inherited display artifacts", async () => {
    const displayUser = {
      id: "local-user",
      kind: "dialogue",
      role: "user",
      text: "Read [[Note]]",
      copyText: "Read [[Note]]",
      dialogueKind: "user",
      turnId: "turn",
      clientId: "submission",
      contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
      provenance: { source: "localUser", channel: "optimistic", interaction: "prompt", sourceId: "submission" },
    } satisfies ThreadStreamItem;
    const serverUser = {
      id: "server-user",
      kind: "dialogue",
      role: "user",
      text: "Read [[Note]]",
      copyText: "Read [[Note]]",
      dialogueKind: "user",
      turnId: "turn",
      clientId: "submission",
    } satisfies ThreadStreamItem;
    const progress = taskProgress("turn");
    const response = activation("thread", { initialHistoryPage: historyPage([serverUser, message("answer", "Done", "assistant")], null) });
    const { commands, host, stateStore } = createActions(response);
    host.history = new HistoryController({
      stateStore,
      source: { readHistoryPage: vi.fn() },
      addSystemMessage: host.addSystemMessage,
      showLatestPageAtBottom: vi.fn(),
      setThreadTurnPresence: vi.fn(),
    });

    const resumed = await commands.resumeThread("thread", undefined, {
      items: [displayUser, progress],
      turnDiffs: new Map([["turn", "diff --git a/Note.md b/Note.md"]]),
    });
    await resumed?.hydrate();

    const state = stateStore.getState();
    expect(state.threadStream.stableItems).toEqual([
      expect.objectContaining({ id: "server-user", contextAttachments: displayUser.contextAttachments }),
      progress,
      expect.objectContaining({ id: "answer", text: "Done" }),
    ]);
    expect(chatThreadStreamViewState(state.threadStream, state.activeTurn).turnDiffs.get("turn")).toBe("diff --git a/Note.md b/Note.md");
  });

  it("does not publish completion work after its activation is superseded", async () => {
    const { commands, host, stateStore } = createActions();
    host.history = new HistoryController({
      stateStore,
      source: { readHistoryPage: vi.fn().mockResolvedValue(historyPage([message("stale", "stale", "assistant")], null)) },
      addSystemMessage: host.addSystemMessage,
      showLatestPageAtBottom: vi.fn(),
      setThreadTurnPresence: vi.fn(),
    });
    const activation = await commands.resumeThread("thread");
    host.resumeWork.begin("other");
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const streamBeforeHydration = stateStore.getState().threadStream;

    await expect(activation?.hydrate()).resolves.toBe(false);

    expect(stateStore.getState().threadStream).toEqual(streamBeforeHydration);
    expect(host.syncThreadGoal).not.toHaveBeenCalled();
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
      kind: "completed",
      value: activation(threadId),
    }));
    const ensureConnected = vi.fn().mockReturnValueOnce(firstConnection.promise).mockResolvedValue(true);
    const { commands, stateStore } = createActions(undefined, {
      effects: { resumeThread },
      ensureConnected,
    });

    const firstResume = commands.resumeThread("first");
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    const secondResume = await commands.resumeThread("second");
    expect(secondResume).not.toBeNull();
    await expect(secondResume?.hydrate()).resolves.toBe(true);
    await firstConnection.resolveAndFlush(true);
    await expect(firstResume).resolves.toBeNull();

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

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();

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

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();
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

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();
    stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage: tokenUsageFixture(99) });

    await recovery.resolveAndFlush(tokenUsageFixture(42));

    expect(activeThreadState(stateStore.getState())?.tokenUsage).toMatchObject({ last: { inputTokens: 99 } });
  });

  it("ignores rollout token usage recovery failures", async () => {
    const response = activation("thread", { rolloutPath: "/tmp/rollout.jsonl" });
    const recoverTokenUsageFromRollout = vi.fn().mockRejectedValue(new Error("read failed"));
    const { commands, host, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();
    await Promise.resolve();

    expect(activeThreadState(stateStore.getState())?.tokenUsage).toBeNull();
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("read failed");
  });
});

function panelThread(id: string): PanelThread {
  return {
    id,
    historyMode: "paginated",
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

function taskProgress(turnId: string): ThreadStreamItem {
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    explanation: null,
    steps: [{ step: "Keep this", status: "completed" }],
    status: "completed",
    executionState: "completed",
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
