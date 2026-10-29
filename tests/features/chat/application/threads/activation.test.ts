import { describe, expect, it, vi } from "vitest";
import type { ThreadTokenUsage } from "../../../../../src/domain/runtime/usage";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import { activeThreadId, activeThreadState } from "../../../../../src/features/chat/application/state/model";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/transition-actions";
import { chatThreadStreamViewState } from "../../../../../src/features/chat/application/state/turn-scope";
import type {
  ThreadActivationHost,
  ThreadResumeEffects,
  ThreadResumeSnapshot,
} from "../../../../../src/features/chat/application/threads/activation";
import type { ThreadHistoryPage } from "../../../../../src/features/chat/application/threads/history-controller";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { resumeSnapshot as activation, createThreadActivationFixture } from "../../support/activation";
import { taskProgressFixture as taskProgress } from "../../support/thread-stream";

function createActions(
  response: ThreadResumeSnapshot | null = activation("thread"),
  overrides: Partial<Omit<ThreadActivationHost, "history">> = {},
) {
  const resumeThread = vi.fn<ThreadResumeEffects["resumeThread"]>(async (_threadId, adopt) => {
    if (response) adopt(response);
  });
  const fixture = createThreadActivationFixture({ ...overrides, effects: overrides.effects ?? { resumeThread } });
  return { ...fixture, resumeThread };
}

describe("ThreadActivation", () => {
  it.each(["reselect", "focus"] as const)("preserves explicit navigation intent across %s", async (action) => {
    const { commands, resumeThread, stateStore, host } = createThreadActivationFixture();
    await commands.activate("first");
    const delayed = deferred<void>();
    resumeThread.mockImplementationOnce(async (threadId, adopt) => {
      await delayed.promise;
      adopt(activation(threadId));
    });
    const opening = commands.activate("second");
    await waitForAsyncWork(() => expect(resumeThread).toHaveBeenCalledTimes(2));

    await commands.activate(action === "reselect" ? "first" : undefined);
    delayed.resolve(undefined);

    await expect(opening).resolves.toBe(action === "focus");
    expect(activeThreadId(stateStore.getState())).toBe(action === "reselect" ? "first" : "second");
    expect(host.recordResumedThread).toHaveBeenLastCalledWith(activation("second").activation.thread);
  });

  it.each(["empty", "restored"] as const)(
    "shares activation and repeated selections through history hydration from %s",
    async (initial) => {
      const connecting = deferred<boolean>();
      const history = deferred<ThreadHistoryPage>();
      const { commands, stateStore, resumeThread, readHistoryPage } = createThreadActivationFixture({
        ensureConnected: () => connecting.promise,
      });
      readHistoryPage.mockReturnValue(history.promise);
      if (initial === "restored")
        stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Saved" });
      expect(resumeThread).not.toHaveBeenCalled();

      const restoring = initial === "restored" ? commands.ensureRestoredThreadLoaded() : commands.activate("thread");
      const opening = commands.activate("thread");
      connecting.resolve(true);
      await waitForAsyncWork(() => expect(readHistoryPage).toHaveBeenCalledOnce());
      let selected = false;
      const reselecting = commands.activate("thread").then((result) => {
        selected = result;
      });
      await Promise.resolve();
      expect(selected).toBe(false);
      await expect(commands.ensureRestoredThreadLoaded()).resolves.toBe(true);
      expect(selected).toBe(false);
      history.resolve(historyPage([message("answer", "Restored answer", "assistant")], "older"));

      await expect(restoring).resolves.toBe(true);
      await expect(opening).resolves.toBe(true);
      await reselecting;
      expect(selected).toBe(true);
      expect(resumeThread).toHaveBeenCalledOnce();
      expect(readHistoryPage).toHaveBeenCalledOnce();
      expect(stateStore.getState().threadStream).toMatchObject({
        historyCursor: "older",
        stableItems: [expect.objectContaining({ text: "Restored answer" })],
      });
    },
  );

  it.each(["reapply", "round-trip"] as const)("starts fresh restoration after a target %s", async (change) => {
    const oldConnection = deferred<boolean>();
    const ensureConnected = vi.fn().mockReturnValueOnce(oldConnection.promise).mockResolvedValue(true);
    const { commands, stateStore, resumeThread } = createThreadActivationFixture({ ensureConnected });
    const restore = (threadId: string) => stateStore.dispatch({ type: "panel/restored-thread-applied", threadId, fallbackTitle: null });
    restore("thread");
    const first = commands.ensureRestoredThreadLoaded();
    if (change === "round-trip") restore("other");
    restore("thread");

    await expect(commands.ensureRestoredThreadLoaded()).resolves.toBe(true);
    oldConnection.resolve(true);
    await expect(first).resolves.toBe(false);
    expect(resumeThread).toHaveBeenCalledExactlyOnceWith("thread", expect.any(Function));
    expect(activeThreadId(stateStore.getState())).toBe("thread");
  });

  it("keeps the active thread and draft after a failed selection, then allows retry", async () => {
    const { commands, stateStore, resumeThread, host } = createThreadActivationFixture();
    await commands.activate("first");
    stateStore.dispatch({ type: "composer/draft-set", draft: "Keep this draft" });
    resumeThread.mockRejectedValueOnce(new Error("Resume failed"));

    await expect(commands.activate("second")).resolves.toBe(false);

    expect(activeThreadId(stateStore.getState())).toBe("first");
    expect(stateStore.getState().composer.draft).toBe("Keep this draft");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Resume failed");
    await expect(commands.activate("second")).resolves.toBe(true);
    expect(activeThreadId(stateStore.getState())).toBe("second");
  });

  it("resumes the thread and loads its latest history", async () => {
    const response = activation("thread");
    const { commands, host, readHistoryPage, resumeThread, stateStore } = createActions({
      ...response,
      activation: { ...response.activation, canAcceptDirectInput: false },
    });

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();

    expect(resumeThread).toHaveBeenCalledWith("thread", expect.any(Function));
    expect(activeThreadId(stateStore.getState())).toBe("thread");
    expect(readHistoryPage).toHaveBeenCalledWith("thread", null, 20);
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.recordResumedThread).toHaveBeenCalledWith(response.activation.thread);
    expect(activeThreadState(stateStore.getState())?.canAcceptDirectInput).toBe(false);
  });

  it("hydrates resumed threads from the initial turns page when app-server returns one", async () => {
    const initialHistoryPage = historyPage([message("u1", "hello", "user")], "older");
    const response = activation("thread", { initialHistoryPage });
    const { commands, stateStore, readHistoryPage, setThreadTurnPresence, showLatestPageAtBottom } = createActions(response);

    const resumed = await commands.resumeThread("thread");
    await resumed?.hydrate();

    expect(stateStore.getState().threadStream).toMatchObject({ stableItems: initialHistoryPage.items, historyCursor: "older" });
    expect(setThreadTurnPresence).toHaveBeenCalledWith(true);
    expect(showLatestPageAtBottom).toHaveBeenCalledOnce();
    expect(readHistoryPage).not.toHaveBeenCalled();
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
    const { commands, stateStore } = createActions(response);

    const resumed = await commands.resumeThread("thread", {
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
    const { commands, stateStore, readHistoryPage } = createActions();
    const activation = await commands.resumeThread("thread");
    commands.invalidate();
    stateStore.dispatch({
      ...threadActivationFixture(panelThread("other")),
      type: "active-thread/resumed",
    });
    const streamBeforeHydration = stateStore.getState().threadStream;

    await expect(activation?.hydrate()).resolves.toBe(false);

    expect(stateStore.getState().threadStream).toEqual(streamBeforeHydration);
    expect(readHistoryPage).not.toHaveBeenCalled();
  });

  it("does not change active thread when the resume port has no snapshot", async () => {
    const { commands, readHistoryPage, resumeThread, stateStore } = createActions(null);

    await commands.resumeThread("thread");

    expect(resumeThread).toHaveBeenCalledWith("thread", expect.any(Function));
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(readHistoryPage).not.toHaveBeenCalled();
  });

  it("does not invoke an older resume after a newer intent wins during connection", async () => {
    const firstConnection = deferred<boolean>();
    const resumeThread = vi.fn<ThreadResumeEffects["resumeThread"]>().mockImplementation(async (threadId, adopt) => {
      adopt(activation(threadId));
    });
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
    firstConnection.resolve(true);
    await expect(firstResume).resolves.toBeNull();

    expect(resumeThread).toHaveBeenCalledExactlyOnceWith("second", expect.any(Function));
    expect(activeThreadId(stateStore.getState())).toBe("second");
  });

  it("records a resumed thread without replacing a turn started during resume", async () => {
    const response = activation("other");
    const pendingResume = deferred<Awaited<ReturnType<ThreadResumeEffects["resumeThread"]>>>();
    const effect = vi.fn<ThreadResumeEffects["resumeThread"]>(async (_threadId, adopt) => {
      await pendingResume.promise;
      adopt(response);
    });
    const { commands, host, stateStore, readHistoryPage } = createActions(response, { effects: { resumeThread: effect } });
    stateStore.dispatch(resumedThreadAction({ response: activation("active").activation }));
    const pending = commands.resumeThread("other");
    await vi.waitFor(() => expect(effect).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });
    const activeTurn = stateStore.getState().activeTurn;
    pendingResume.resolve(undefined);
    await expect(pending).resolves.toBeNull();
    expect(activeThreadId(stateStore.getState())).toBe("active");
    expect(stateStore.getState().activeTurn).toBe(activeTurn);
    expect(host.recordResumedThread).toHaveBeenCalledWith(response.activation.thread);
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(readHistoryPage).not.toHaveBeenCalled();
  });

  it("does not switch threads while a different turn is busy", async () => {
    const { commands, host, resumeThread, stateStore } = createActions();
    stateStore.dispatch({
      ...threadActivationFixture(panelThread("active")),
      type: "active-thread/resumed",
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
    const { commands, readHistoryPage, stateStore } = createActions(response, { recoverTokenUsageFromRollout });

    await expect(commands.activate("thread")).resolves.toBe(true);

    expect(recoverTokenUsageFromRollout).toHaveBeenCalledWith("/tmp/rollout.jsonl");
    expect(readHistoryPage).toHaveBeenCalledWith("thread", null, 20);
    expect(activeThreadState(stateStore.getState())?.tokenUsage).toBeNull();

    recovery.resolve(tokenUsageFixture(42));
    await Promise.resolve();

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
      ...threadActivationFixture(second.activation.thread),
      type: "active-thread/resumed",
    });

    recovery.resolve(tokenUsageFixture(42));
    await Promise.resolve();

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

    recovery.resolve(tokenUsageFixture(42));
    await Promise.resolve();

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
  return panelThreadFixture({
    id,
    createdAt: 0,
    updatedAt: 0,
  });
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
