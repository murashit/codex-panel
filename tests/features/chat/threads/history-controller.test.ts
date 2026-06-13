import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { HistoryController } from "../../../../src/features/chat/threads/history-controller";
import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";
import { deferred } from "../../../support/async";
import { chatStateDisplayItems } from "../support/message-stream";

describe("HistoryController", () => {
  it("keeps the latest history load when an older request resolves later", async () => {
    const first = deferred<ThreadTurnsListResponse>();
    const second = deferred<ThreadTurnsListResponse>();
    const { loader, stateStore } = historyFixture({
      threadTurnsList: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });

    const firstLoad = loader.loadLatest();
    const secondLoad = loader.loadLatest();

    second.resolve(threadTurnsResponse([], "second-cursor"));
    await secondLoad;
    first.resolve(threadTurnsResponse([], "first-cursor"));
    await firstLoad;

    expect(stateStore.getState().messageStream.historyCursor).toBe("second-cursor");
    expect(stateStore.getState().messageStream.loadingHistory).toBe(false);
  });

  it("ignores a history load that is invalidated while pending", async () => {
    const pending = deferred<ThreadTurnsListResponse>();
    const { loader, stateStore, addSystemMessage } = historyFixture({
      threadTurnsList: vi.fn().mockReturnValue(pending.promise),
    });

    const loading = loader.loadLatest();
    expect(stateStore.getState().messageStream.loadingHistory).toBe(true);

    loader.invalidate();
    pending.resolve(threadTurnsResponse([turnFixture([assistantMessage("assistant", "Stale")])], "stale-cursor"));
    await loading;

    expect(chatStateDisplayItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().messageStream.historyCursor).toBeNull();
    expect(stateStore.getState().messageStream.loadingHistory).toBe(false);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("applies an already returned latest turns page without requesting history", () => {
    const threadTurnsList = vi.fn();
    const { loader, stateStore, showLatestPageAtBottom } = historyFixture({ threadTurnsList });

    const applied = loader.applyLatestPage("thread", threadTurnsResponse([turnFixture([assistantMessage("assistant", "Ready")])], "older"));

    expect(applied).toBe(true);
    expect(threadTurnsList).not.toHaveBeenCalled();
    expect(chatStateDisplayItems(stateStore.getState())).toEqual([
      expect.objectContaining({ id: "assistant", text: "Ready", turnId: "turn" }),
    ]);
    expect(stateStore.getState().messageStream.historyCursor).toBe("older");
    expect(showLatestPageAtBottom).toHaveBeenCalledOnce();
  });

  it("ignores already returned latest turns pages for stale threads", () => {
    const { loader, stateStore } = historyFixture({ threadTurnsList: vi.fn() });

    const applied = loader.applyLatestPage("other", threadTurnsResponse([turnFixture([assistantMessage("assistant", "Stale")])], "older"));

    expect(applied).toBe(false);
    expect(chatStateDisplayItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().messageStream.historyCursor).toBeNull();
  });

  it("loads older history without coupling message stream replacement to bottom pin state", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue(threadTurnsResponse([turnFixture([assistantMessage("older", "Older")])], "next"));
    const { loader, stateStore, dispatch, keepCurrentScrollPosition, showLatestPageAtBottom } = historyFixture({ threadTurnsList });
    stateStore.dispatch({ type: "message-stream/items-replaced", items: [message("current", "Current")], historyCursor: "cursor" });

    await loader.loadOlder();

    expect(threadTurnsList).toHaveBeenCalledWith("thread", "cursor", 20);
    expect(chatStateDisplayItems(stateStore.getState()).map((item) => item.id)).toEqual(["older", "current"]);
    expect(stateStore.getState().messageStream.historyCursor).toBe("next");
    expect(keepCurrentScrollPosition).toHaveBeenCalledOnce();
    expect(showLatestPageAtBottom).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "message-stream/items-replaced" }));
  });
});

type ThreadTurnsListResponse = Awaited<ReturnType<AppServerClient["threadTurnsList"]>>;

function historyFixture(options: { threadTurnsList: ReturnType<typeof vi.fn> }) {
  const state = createChatState();
  state.activeThread.id = "thread";
  const stateStore = createChatStateStore(state);
  const dispatch = vi.spyOn(stateStore, "dispatch");
  const addSystemMessage = vi.fn();
  const keepCurrentScrollPosition = vi.fn();
  const showLatestPageAtBottom = vi.fn();
  const loader = new HistoryController({
    stateStore,
    currentClient: () =>
      ({
        threadTurnsList: options.threadTurnsList,
      }) as unknown as AppServerClient,
    addSystemMessage,
    keepCurrentScrollPosition,
    showLatestPageAtBottom,
    setThreadTurnPresence: vi.fn(),
  });
  return { loader, stateStore, addSystemMessage, dispatch, keepCurrentScrollPosition, showLatestPageAtBottom };
}

function threadTurnsResponse(data: TurnRecord[], nextCursor: string | null): ThreadTurnsListResponse {
  return { data, nextCursor, backwardsCursor: null };
}

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

function assistantMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function message(id: string, text: string) {
  return {
    id,
    kind: "message" as const,
    role: "assistant" as const,
    text,
    messageKind: "assistantResponse" as const,
    messageState: "completed" as const,
  };
}
