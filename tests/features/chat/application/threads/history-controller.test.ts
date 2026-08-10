import { describe, expect, it, vi } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  HistoryController,
  type ThreadHistoryPage,
  type ThreadHistorySource,
} from "../../../../../src/features/chat/application/threads/history-controller";
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
    const { loader, stateStore, dispatch, showLatestPageAtBottom } = historyFixture({ readHistoryPage });
    stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: [message("current", "Current", "current-turn")],
      historyCursor: "cursor",
    });

    await loader.loadOlder();

    expect(readHistoryPage).toHaveBeenCalledWith("thread", "cursor", 20);
    expect(chatStateThreadStreamItems(stateStore.getState()).map((item) => item.id)).toEqual(["older", "current"]);
    expect(stateStore.getState().threadStream.historyCursor).toBe("next");
    expect(showLatestPageAtBottom).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "thread-stream/items-replaced" }));
  });

  it("hydrates snapshot-retained older turns instead of dropping the server page", async () => {
    const inheritedUser = userMessage("local-older", "Inherited older", "older-turn", "older-submission", true);
    const canonicalUser = userMessage("server-older", "Canonical older", "older-turn", "older-submission");
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(historyPage([canonicalUser], null));
    const { loader, stateStore } = historyFixture({ readHistoryPage });
    const progress = taskProgress("older-turn");
    stateStore.dispatch({
      type: "thread-stream/items-replaced",
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
  const dispatch = vi.spyOn(stateStore, "dispatch");
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
  return { loader, stateStore, addSystemMessage, dispatch, setThreadTurnPresence, showLatestPageAtBottom };
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
    status: "completed",
    executionState: "completed",
  };
}
