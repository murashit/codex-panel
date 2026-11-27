import { describe, expect, it, vi } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { localUserDialogueItemFromInput } from "../../../../../src/features/chat/application/submission/local-user-dialogue";
import { HistoryController, type ThreadHistorySource } from "../../../../../src/features/chat/application/threads/history-controller";
import { projectTurnRuntimeFact } from "../../../../../src/features/chat/application/turns/runtime-fact-projection";
import type { ThreadHistoryPage } from "../../../../../src/features/chat/domain/thread-stream/history";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred, eventOrders } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { chatStateFixture } from "../../support/state";
import { chatStateThreadStreamItems, historyPage, taskProgressFixture as taskProgress } from "../../support/thread-stream";

describe("HistoryController", () => {
  it.each(["loadLatest", "loadOlder"] as const)("keeps a completed live turn when %s returns an older snapshot", async (method) => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture(() => pending.promise, { historyCursor: "cursor" });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "running" });
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: "Hello" });
    const loading = loader[method]();
    stateStore.dispatch({
      type: "turn/completed",
      turnId: "running",
      outcome: "completed",
      turnItems: [],
    });

    pending.resolve(historyPage({ "older-turn": [message("older", "Earlier")], running: [message("answer", "Stale")] }));
    await loading;

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "older" }),
      expect.objectContaining({ id: "answer", text: "Hello" }),
    ]);
  });

  it("replaces old history but keeps a turn completed after the latest read started", async () => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore, setThreadTurnPresence } = historyFixture(() => pending.promise, {
      stableItems: [message("old", "Old history", "old-turn")],
    });
    const loading = loader.loadLatest();
    completeLiveTurn(stateStore);

    pending.resolve(historyPage({}));
    await loading;

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([expect.objectContaining({ id: "answer", text: "Hello" })]);
    expect(setThreadTurnPresence).not.toHaveBeenCalledWith(false);
    await loader.loadLatest();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
  });

  it.each(eventOrders("first", "latest", "live"))("keeps the latest page and live completion for $order", async ({ order }) => {
    const first = deferred<ThreadHistoryPage>();
    const latest = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture(
      vi.fn<HistoryPageReader>().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise),
    );
    const loads = { first: loader.loadLatest(), latest: loader.loadLatest() };
    let published = false;
    for (const event of order) {
      if (event === "live") completeLiveTurn(stateStore);
      else {
        const reply = event === "first" ? first : latest;
        reply.resolve(historyPage({ "old-turn": [message("page", event)] }, event));
        await loads[event];
        published ||= event === "latest";
      }
      expect(stateStore.getState().threadStream.historyCursor).toBe(published ? "latest" : null);
      expect(stateStore.getState().threadStream.loadingHistory).toBe(!published);
    }
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "page", text: "latest" }),
      expect.objectContaining({ id: "answer", text: "Hello" }),
    ]);
  });

  it.each(["explicit invalidation", "navigation away and back"])("ignores a pending history page after %s", async (change) => {
    const pending = deferred<ThreadHistoryPage | null>();
    const { loader, stateStore, addSystemMessage } = historyFixture(() => pending.promise);

    const loading = loader.loadLatest();
    expect(stateStore.getState().threadStream.loadingHistory).toBe(true);

    if (change === "explicit invalidation") loader.invalidate();
    else {
      for (const id of ["other", "thread"]) {
        stateStore.dispatch({ type: "active-thread/resumed", ...threadActivationFixture(panelThreadFixture({ id })) });
      }
    }
    pending.resolve(historyPage({ turn: [message("assistant", "Stale")] }, "stale-cursor"));
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
      .mockResolvedValueOnce(historyPage({ turn: [message("recovered", "Recovered")] }));
    const { loader, stateStore, addSystemMessage } = historyFixture(readHistoryPage, { historyCursor: "older" });

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

  it("loads only older source pages for a draft and never reloads the source latest page", async () => {
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(historyPage({ "older-turn": [message("older", "Older")] }));
    const { loader, stateStore } = historyFixture(readHistoryPage);
    applyForkDraft(stateStore, "boundary");

    await loader.loadLatest();
    await loader.loadLatest("source");
    expect(readHistoryPage).not.toHaveBeenCalled();
    await loader.loadOlder();

    expect(chatStateThreadStreamItems(stateStore.getState()).map((item) => item.id)).toEqual(["older", "boundary"]);
    expect(stateStore.getState().threadStream.historyCursor).toBeNull();

    await loader.loadOlder();
    await loader.loadLatest();
    expect(readHistoryPage).toHaveBeenCalledExactlyOnceWith("source", "source-older", 20);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an older page that %s after switching draft boundaries on the same source",
    async (outcome) => {
      const pending = deferred<ThreadHistoryPage>();
      const readHistoryPage = vi.fn<HistoryPageReader>().mockReturnValue(pending.promise);
      const { loader, stateStore, addSystemMessage } = historyFixture(readHistoryPage);
      applyForkDraft(stateStore, "boundary");
      const loading = loader.loadOlder();
      applyForkDraft(stateStore, "other-boundary");

      if (outcome === "resolve") pending.resolve(historyPage({ turn: [message("stale", "Stale")] }, "stale-cursor"));
      else pending.reject(new Error("Stale error"));
      await loading;

      expect(chatStateThreadStreamItems(stateStore.getState()).map((item) => item.id)).toEqual(["other-boundary"]);
      expect(stateStore.getState().threadStream.historyCursor).toBe("source-older");
      expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
      expect(addSystemMessage).not.toHaveBeenCalled();
    },
  );

  it("pages older history in place and hydrates overlapping turns with their local context", async () => {
    const inheritedUser = userMessage("local-older", "Inherited older", "older-turn", "older-submission", true);
    const canonicalUser = userMessage("server-older", "Canonical older", "older-turn", "older-submission");
    const earlier = message("earlier", "Earlier answer", "earliest-turn");
    const readHistoryPage = vi
      .fn<HistoryPageReader>()
      .mockResolvedValue(historyPage({ "earliest-turn": [earlier], "older-turn": [canonicalUser] }, "next"));
    const progress = taskProgress("older-turn");
    const { loader, stateStore, showLatestPageAtBottom } = historyFixture(readHistoryPage, {
      stableItems: [inheritedUser, progress, message("current", "Current", "current-turn")],
      historyCursor: "cursor",
    });

    await loader.loadOlder();

    expect(readHistoryPage).toHaveBeenCalledWith("thread", "cursor", 20);
    expect(stateStore.getState().threadStream.historyCursor).toBe("next");
    expect(showLatestPageAtBottom).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      earlier,
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
    const { loader, stateStore } = historyFixture(() => pending.promise, { historyCursor: "cursor" });
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

    const canonicalUser = {
      id: "external-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Live parent input",
      turnId: "running",
    } as const;
    for (const action of projectTurnRuntimeFact(stateStore.getState(), {
      type: "userMessageObserved",
      item: canonicalUser,
    }).actions)
      stateStore.dispatch(action);
    pending.resolve(historyPage({ "older-turn": [message("older", "Earlier answer")], running: [canonicalUser] }));
    await loading;
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([steer]);
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: " world" });
    const observed = projectTurnRuntimeFact(stateStore.getState(), { type: "userMessageObserved", item: { ...steer, id: "server-steer" } });
    for (const action of observed.actions) stateStore.dispatch(action);

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "older" }),
      canonicalUser,
      expect.objectContaining({ id: "answer", text: "Hello world" }),
      expect.objectContaining({ id: "server-steer", text: "Clarify" }),
    ]);
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([]);
  });

  it.each(["loadLatest", "loadOlder"] as const)(
    "keeps an optimistic prompt in its turn when %s settles before acknowledgement",
    async (method) => {
      const pending = deferred<ThreadHistoryPage>();
      const { loader, stateStore } = historyFixture(() => pending.promise, { historyCursor: "cursor" });
      const loading = loader[method]();
      const item = localUserDialogueItemFromInput({ id: "prompt", text: "Continue", codexInput: [] });
      stateStore.dispatch({ type: "turn/optimistic-started", item });

      pending.resolve(historyPage({ "older-turn": [message("older", "Earlier answer")] }));
      await loading;
      expect(stateStore.getState().activeTurn.activeSegment?.items).toEqual([item]);
      stateStore.dispatch({
        type: "turn/start-acknowledged",
        threadId: "thread",
        anchorItemId: "prompt",
        turnId: "running",
      });

      expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
        expect.objectContaining({ id: "older" }),
        expect.objectContaining({ id: "prompt", text: "Continue", turnId: "running" }),
      ]);
    },
  );

  it("inserts missing history while keeping live progress in order and continuing the streamed answer", async () => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture(() => pending.promise);
    const loading = loader.loadLatest();
    const prompt = userMessage("prompt", "Explain the change", "running", "prompt-client");
    const followUp = userMessage("follow-up", "Include an example", "running", "follow-up-client");
    const progress = taskProgress("running");
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "running" });
    stateStore.dispatch({ type: "thread-stream/item-upserted", item: followUp });
    stateStore.dispatch({ type: "thread-stream/item-upserted", item: progress });
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: "Hello" });

    pending.resolve(historyPage({ running: [prompt, followUp, message("answer", "Stale answer")] }));
    await loading;
    stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: " world" });

    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      prompt,
      followUp,
      progress,
      expect.objectContaining({ id: "answer", text: "Hello world" }),
    ]);
  });

  it("adopts a prompt returned by history before the turn-start acknowledgement", async () => {
    const pending = deferred<ThreadHistoryPage>();
    const { loader, stateStore } = historyFixture(() => pending.promise);
    const loading = loader.loadLatest();
    const local = localUserDialogueItemFromInput({ id: "local-user-prompt", clientId: "submission", text: "Continue", codexInput: [] });
    const server = userMessage("server-prompt", "Continue", "running", "submission");
    stateStore.dispatch({ type: "turn/optimistic-started", item: local });
    const answer = message("answer", "Response", "running");
    pending.resolve(historyPage({ running: [server, answer] }));
    await loading;
    expect(stateStore.getState().activeTurn.activeSegment?.items).toEqual([server, answer]);
    stateStore.dispatch({ type: "turn/start-acknowledged", threadId: "thread", turnId: "running", anchorItemId: local.id });
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([server, answer]);
  });

  it("clears loading state when the history port has no page", async () => {
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(null);
    const { loader, stateStore, addSystemMessage, setThreadTurnPresence } = historyFixture(readHistoryPage);

    await loader.loadLatest();

    expect(readHistoryPage).toHaveBeenCalledWith("thread", null, 20);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().threadStream.loadingHistory).toBe(false);
    expect(setThreadTurnPresence).not.toHaveBeenCalled();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

type HistoryPageReader = ThreadHistorySource["readHistoryPage"];

function historyFixture(
  readHistoryPage: HistoryPageReader = async () => null,
  threadStream: { historyCursor?: string; stableItems?: readonly ThreadStreamItem[] } = {},
) {
  const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" }, threadStream }));
  const addSystemMessage = vi.fn();
  const showLatestPageAtBottom = vi.fn();
  const setThreadTurnPresence = vi.fn();
  const loader = new HistoryController({
    stateStore,
    source: { readHistoryPage },
    addSystemMessage,
    showLatestPageAtBottom,
    setThreadTurnPresence,
  });
  return { loader, stateStore, addSystemMessage, setThreadTurnPresence, showLatestPageAtBottom };
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

function applyForkDraft(stateStore: ReturnType<typeof createChatStateStore>, turnId: string): void {
  stateStore.dispatch({
    type: "panel/fork-draft-applied",
    preparation: {
      draft: {
        kind: "persistent",
        sourceThreadId: "source",
        boundary: { kind: "through-turn", turnId },
      },
      runtime: stateStore.getState().runtime,
      display: { items: [message(turnId, turnId, turnId)], turnDiffs: new Map(), historyCursor: "source-older" },
    },
  });
}

function completeLiveTurn(stateStore: ReturnType<typeof createChatStateStore>): void {
  stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "running" });
  stateStore.dispatch({ type: "thread-stream/assistant-delta-appended", itemId: "answer", turnId: "running", delta: "Hello" });
  stateStore.dispatch({
    type: "turn/completed",
    turnId: "running",
    outcome: "completed",
    turnItems: [],
  });
}
