import { describe, expect, it, vi } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  acknowledgeOptimisticTurnStart,
  optimisticTurnStart,
} from "../../../../../src/features/chat/application/submission/optimistic-turn-start";
import {
  HistoryController,
  type ThreadHistoryPage,
  type ThreadHistorySource,
} from "../../../../../src/features/chat/application/threads/history-controller";
import { projectTurnRuntimeFact } from "../../../../../src/features/chat/application/turns/runtime-fact-projection";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

describe("HistoryController", () => {
  it("keeps the latest history load when an older request resolves later", async () => {
    const first = deferred<ThreadHistoryPage | null>();
    const second = deferred<ThreadHistoryPage | null>();
    const { loader, stateStore } = historyFixture({
      readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });

    const firstLoad = loader.loadLatest();
    const secondLoad = loader.loadLatest();

    second.resolve(historyPage([], "second-cursor"));
    await secondLoad;
    first.resolve(historyPage([], "first-cursor"));
    await firstLoad;

    expect(stateStore.getState().threadStream.historyCursor).toBe("second-cursor");
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
  });

  it("ignores a history load that is invalidated while pending", async () => {
    const pending = deferred<ThreadHistoryPage | null>();
    const { loader, stateStore, addSystemMessage } = historyFixture({
      readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValue(pending.promise),
    });

    const loading = loader.loadLatest();
    expect(stateStore.getState().threadStream.loadingHistory).toBe(true);

    loader.invalidate();
    pending.resolve(historyPage([message("assistant", "Stale")], "stale-cursor"));
    await loading;

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().threadStream.historyCursor).toBeNull();
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it.each(["loadLatest", "loadOlder"] as const)("reports only the current %s failure and permits retry", async (method) => {
    const stale = deferred<ThreadHistoryPage | null>();
    const current = deferred<ThreadHistoryPage | null>();
    const readHistoryPage = vi
      .fn<HistoryPageReader>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise)
      .mockResolvedValueOnce(historyPage([message("recovered", "Recovered")], null));
    const { loader, stateStore, addSystemMessage } = historyFixture({ readHistoryPage });
    stateStore.dispatch({ type: "thread-stream/content-replaced", items: [], historyCursor: "older" });

    const staleLoad = loader[method]();
    loader.invalidate();
    const currentLoad = loader[method]();
    stale.reject(new Error("Stale failure"));
    await staleLoad;

    expect(addSystemMessage).not.toHaveBeenCalled();
    expect(stateStore.getState().threadStream.loadingHistory).toBe(true);

    current.reject(new Error("History unavailable"));
    await currentLoad;

    expect(addSystemMessage).toHaveBeenCalledExactlyOnceWith("History unavailable");
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(stateStore.getState().threadStream.historyCursor).toBe("older");

    await loader[method]();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([expect.objectContaining({ id: "recovered", text: "Recovered" })]);
  });

  it("applies an already returned latest turns page without requesting history", () => {
    const readHistoryPage = vi.fn<HistoryPageReader>();
    const { loader, stateStore, showLatestPageAtBottom } = historyFixture({ readHistoryPage });

    const applied = loader.applyLatestPage("thread", historyPage([message("assistant", "Ready")], "older"));

    expect(applied).toBe(true);
    expect(readHistoryPage).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "assistant", text: "Ready", turnId: "turn" }),
    ]);
    expect(stateStore.getState().threadStream.historyCursor).toBe("older");
    expect(showLatestPageAtBottom).toHaveBeenCalledOnce();
  });

  it("reconciles hydrated history with an operation-local fork display snapshot", () => {
    const readHistoryPage = vi.fn<HistoryPageReader>();
    const { loader, stateStore } = historyFixture({ readHistoryPage });
    const progress = taskProgress("turn");

    const applied = loader.applyLatestPage("thread", historyPage([message("assistant", "Server history")], "older"), {
      displayItems: [message("assistant", "Stale display"), progress],
    });

    expect(applied).toBe(true);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "assistant", text: "Server history" }),
      progress,
    ]);
  });

  it("ignores already returned latest turns pages for stale threads", () => {
    const { loader, stateStore } = historyFixture({ readHistoryPage: vi.fn<HistoryPageReader>() });

    const applied = loader.applyLatestPage("other", historyPage([message("assistant", "Stale")], "older"));

    expect(applied).toBe(false);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().threadStream.historyCursor).toBeNull();
  });

  it("loads older history without coupling thread stream replacement to bottom pin state", async () => {
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(historyPage([message("older", "Older", "older-turn")], "next"));
    const { loader, stateStore, showLatestPageAtBottom } = historyFixture({ readHistoryPage });
    stateStore.dispatch({
      type: "thread-stream/content-replaced",
      items: [message("current", "Current", "current-turn")],
      historyCursor: "cursor",
    });

    await loader.loadOlder();

    expect(readHistoryPage).toHaveBeenCalledWith("thread", "cursor", 20);
    expect(chatStateThreadStreamItems(stateStore.getState()).map((item) => item.id)).toEqual(["older", "current"]);
    expect(stateStore.getState().threadStream.historyCursor).toBe("next");
    expect(showLatestPageAtBottom).not.toHaveBeenCalled();
  });

  it("hydrates snapshot-retained older turns instead of dropping the server page", async () => {
    const inheritedUser = userMessage("local-older", "Inherited older", "older-turn", "older-submission", true);
    const canonicalUser = userMessage("server-older", "Canonical older", "older-turn", "older-submission");
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(historyPage([canonicalUser], null));
    const { loader, stateStore } = historyFixture({ readHistoryPage });
    const progress = taskProgress("older-turn");
    stateStore.dispatch({
      type: "thread-stream/content-replaced",
      items: [inheritedUser, progress, message("current", "Current", "current-turn")],
      historyCursor: "cursor",
    });

    await loader.loadOlder();

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({
        id: "server-older",
        text: "Canonical older",
        contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
      }),
      progress,
      expect.objectContaining({ id: "current", text: "Current" }),
    ]);
  });

  it.each(["loadLatest", "loadOlder"] as const)("keeps streaming and pending guidance when %s settles during a turn", async (method) => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture({ readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValue(pending.promise) });
    loader.applyLatestPage("thread", historyPage([], "cursor"));
    const loading = loader[method]();
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "running" });
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: "Hello" });
    const steer = {
      id: "steer",
      clientId: "steer",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Clarify",
      turnId: "running",
    } as const;
    stateStore.dispatch({ type: "thread-stream/pending-steer-added", item: steer });

    pending.resolve(historyPage([message("older", "Earlier answer", "older-turn")], null));
    await loading;
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([steer]);
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: " world" });
    const observed = projectTurnRuntimeFact(stateStore.getState(), { type: "userMessageObserved", item: { ...steer, id: "server-steer" } });
    for (const action of observed.actions) stateStore.dispatch(action);

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "older" }),
      expect.objectContaining({ id: "answer", text: "Hello world" }),
      expect.objectContaining({ id: "server-steer", text: "Clarify" }),
    ]);
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([]);
  });

  it.each(["loadLatest", "loadOlder"] as const)(
    "keeps an optimistic prompt in its turn when %s settles before acknowledgement",
    async (method) => {
      const pending = deferred<ThreadHistoryPage>();
      const { loader, stateStore } = historyFixture({ readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValue(pending.promise) });
      loader.applyLatestPage("thread", historyPage([], "cursor"));
      const loading = loader[method]();
      const start = optimisticTurnStart({ id: "prompt", text: "Continue", codexInput: [] });
      stateStore.dispatch({ type: "turn/optimistic-started", ...start });
      const hook = { id: "prompt-hook", sourceItemId: "prompt-hook", kind: "hook", role: "tool", text: "Preparing" } as const;
      const hookProjection = projectTurnRuntimeFact(stateStore.getState(), {
        type: "hookRunObserved",
        item: hook,
        turnId: null,
        isPromptSubmission: true,
      });
      for (const action of hookProjection.actions) stateStore.dispatch(action);

      pending.resolve(historyPage([message("older", "Earlier answer", "older-turn")], null));
      await loading;
      expect(stateStore.getState().activeTurn.activeSegment?.items).toEqual([start.item, hook]);
      const lifecycle = stateStore.getState().activeTurn.lifecycle;
      stateStore.dispatch({
        type: "turn/start-acknowledged",
        turnId: "running",
        items: acknowledgeOptimisticTurnStart({
          items: chatStateThreadStreamItems(stateStore.getState()),
          optimisticUserId: "prompt",
          turnId: "running",
          pendingTurnStart: lifecycle.kind === "starting" ? lifecycle.pendingTurnStart : null,
        }),
      });

      expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
        expect.objectContaining({ id: "older" }),
        expect.objectContaining({ id: "prompt", text: "Continue", turnId: "running" }),
        expect.objectContaining({ id: "prompt-hook", text: "Preparing", turnId: "running" }),
      ]);
    },
  );

  it("hydrates missing active-turn history before live content without replacing newer text", async () => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture({ readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValue(pending.promise) });
    const loading = loader.loadLatest();
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "running" });
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: "Hello" });
    pending.resolve(
      historyPage([userMessage("prompt", "Explain", "running", "prompt-client"), message("answer", "Earlier snapshot", "running")], null),
    );
    await loading;
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: " world" });

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "prompt", text: "Explain" }),
      expect.objectContaining({ id: "answer", text: "Hello world" }),
    ]);
  });

  it("clears loading state when the history port has no page", async () => {
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(null);
    const { loader, stateStore, addSystemMessage, setThreadTurnPresence } = historyFixture({ readHistoryPage });

    await loader.loadLatest();

    expect(readHistoryPage).toHaveBeenCalledWith("thread", null, 20);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(setThreadTurnPresence).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

type HistoryPageReader = ThreadHistorySource["readHistoryPage"];

function historyFixture(options: { readHistoryPage: ReturnType<typeof vi.fn<HistoryPageReader>> }) {
  let state = chatStateFixture();
  state = chatStateWith(state, { activeThread: { id: "thread" } });
  const stateStore = createChatStateStore(state);
  const addSystemMessage = vi.fn();
  const showLatestPageAtBottom = vi.fn();
  const setThreadTurnPresence = vi.fn();
  const loader = new HistoryController({
    stateStore,
    source: {
      readHistoryPage: options.readHistoryPage,
    },
    addSystemMessage,
    showLatestPageAtBottom,
    setThreadTurnPresence,
  });
  return { loader, stateStore, addSystemMessage, setThreadTurnPresence, showLatestPageAtBottom };
}

function historyPage(items: ThreadStreamItem[], nextCursor: string | null): ThreadHistoryPage {
  return { items, nextCursor, hadTurns: items.length > 0 };
}

function message(id: string, text: string, turnId = "turn"): ThreadStreamItem {
  return {
    id,
    kind: "dialogue" as const,
    role: "assistant" as const,
    text,
    dialogueKind: "assistantResponse" as const,
    dialogueState: "completed" as const,
    turnId,
  };
}

function userMessage(id: string, text: string, turnId: string, clientId: string, inherited = false): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    role: "user",
    text,
    copyText: text,
    dialogueKind: "user",
    turnId,
    clientId,
    ...(inherited
      ? {
          contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
          provenance: { source: "localUser" as const, channel: "optimistic" as const, interaction: "prompt" as const, sourceId: clientId },
        }
      : {}),
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
    executionState: "completed",
  };
}
