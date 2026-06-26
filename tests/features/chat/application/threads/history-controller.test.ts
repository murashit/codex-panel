import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { ChatThreadHistoryPage } from "../../../../../src/features/chat/app-server/threads/projection";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { HistoryController, type HistoryControllerHost } from "../../../../../src/features/chat/application/threads/history-controller";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { deferred } from "../../../../support/async";
import { chatStateMessageStreamItems } from "../../support/message-stream";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("HistoryController", () => {
  it("keeps the latest history load when an older request resolves later", async () => {
    const first = deferred<ChatThreadHistoryPage>();
    const second = deferred<ChatThreadHistoryPage>();
    const { loader, stateStore } = historyFixture({
      readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });

    const firstLoad = loader.loadLatest();
    const secondLoad = loader.loadLatest();

    second.resolve(historyPage([], "second-cursor"));
    await secondLoad;
    first.resolve(historyPage([], "first-cursor"));
    await firstLoad;

    expect(stateStore.getState().messageStream.historyCursor).toBe("second-cursor");
    expect(stateStore.getState().messageStream.loadingHistory).toBe(false);
  });

  it("ignores a history load that is invalidated while pending", async () => {
    const pending = deferred<ChatThreadHistoryPage>();
    const { loader, stateStore, addSystemMessage } = historyFixture({
      readHistoryPage: vi.fn<HistoryPageReader>().mockReturnValue(pending.promise),
    });

    const loading = loader.loadLatest();
    expect(stateStore.getState().messageStream.loadingHistory).toBe(true);

    loader.invalidate();
    pending.resolve(historyPage([message("assistant", "Stale")], "stale-cursor"));
    await loading;

    expect(chatStateMessageStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().messageStream.historyCursor).toBeNull();
    expect(stateStore.getState().messageStream.loadingHistory).toBe(false);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("applies an already returned latest turns page without requesting history", () => {
    const readHistoryPage = vi.fn<HistoryPageReader>();
    const { loader, stateStore, showLatestPageAtBottom } = historyFixture({ readHistoryPage });

    const applied = loader.applyLatestPage("thread", historyPage([message("assistant", "Ready")], "older"));

    expect(applied).toBe(true);
    expect(readHistoryPage).not.toHaveBeenCalled();
    expect(chatStateMessageStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "assistant", text: "Ready", turnId: "turn" }),
    ]);
    expect(stateStore.getState().messageStream.historyCursor).toBe("older");
    expect(showLatestPageAtBottom).toHaveBeenCalledOnce();
  });

  it("ignores already returned latest turns pages for stale threads", () => {
    const { loader, stateStore } = historyFixture({ readHistoryPage: vi.fn<HistoryPageReader>() });

    const applied = loader.applyLatestPage("other", historyPage([message("assistant", "Stale")], "older"));

    expect(applied).toBe(false);
    expect(chatStateMessageStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().messageStream.historyCursor).toBeNull();
  });

  it("loads older history without coupling message stream replacement to bottom pin state", async () => {
    const readHistoryPage = vi.fn<HistoryPageReader>().mockResolvedValue(historyPage([message("older", "Older")], "next"));
    const { loader, stateStore, dispatch, showLatestPageAtBottom } = historyFixture({ readHistoryPage });
    stateStore.dispatch({ type: "message-stream/items-replaced", items: [message("current", "Current")], historyCursor: "cursor" });

    await loader.loadOlder();

    expect(readHistoryPage).toHaveBeenCalledWith(expect.anything(), "thread", "cursor", 20);
    expect(chatStateMessageStreamItems(stateStore.getState()).map((item) => item.id)).toEqual(["older", "current"]);
    expect(stateStore.getState().messageStream.historyCursor).toBe("next");
    expect(showLatestPageAtBottom).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "message-stream/items-replaced" }));
  });
});

type HistoryPageReader = NonNullable<HistoryControllerHost["readHistoryPage"]>;

function historyFixture(options: { readHistoryPage: ReturnType<typeof vi.fn<HistoryPageReader>> }) {
  let state = chatStateFixture();
  state = chatStateWith(state, { activeThread: { id: "thread" } });
  const stateStore = createChatStateStore(state);
  const dispatch = vi.spyOn(stateStore, "dispatch");
  const addSystemMessage = vi.fn();
  const showLatestPageAtBottom = vi.fn();
  const loader = new HistoryController({
    stateStore,
    currentClient: () => ({}) as AppServerClient,
    addSystemMessage,
    showLatestPageAtBottom,
    setThreadTurnPresence: vi.fn(),
    readHistoryPage: options.readHistoryPage,
  });
  return { loader, stateStore, addSystemMessage, dispatch, showLatestPageAtBottom };
}

function historyPage(items: MessageStreamItem[], nextCursor: string | null): ChatThreadHistoryPage {
  return { items, nextCursor, hadTurns: items.length > 0 };
}

function message(id: string, text: string): MessageStreamItem {
  return {
    id,
    kind: "message" as const,
    role: "assistant" as const,
    text,
    messageKind: "assistantResponse" as const,
    messageState: "completed" as const,
    turnId: "turn",
  };
}
