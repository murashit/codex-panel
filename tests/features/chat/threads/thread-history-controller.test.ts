import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { ThreadHistoryController } from "../../../../src/features/chat/threads/thread-history-controller";
import type { AppServerClient } from "../../../../src/app-server/client";
import type { ThreadItem } from "../../../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../../../src/generated/app-server/v2/Turn";
import { deferred } from "../../../support/async";

describe("ThreadHistoryController", () => {
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

    expect(stateStore.getState().transcript.historyCursor).toBe("second-cursor");
    expect(stateStore.getState().transcript.loadingHistory).toBe(false);
  });

  it("ignores a history load that is invalidated while pending", async () => {
    const pending = deferred<ThreadTurnsListResponse>();
    const { loader, stateStore, addSystemMessage } = historyFixture({
      threadTurnsList: vi.fn().mockReturnValue(pending.promise),
    });

    const loading = loader.loadLatest();
    expect(stateStore.getState().transcript.loadingHistory).toBe(true);

    loader.invalidate();
    pending.resolve(threadTurnsResponse([turnFixture([assistantMessage("assistant", "Stale")])], "stale-cursor"));
    await loading;

    expect(stateStore.getState().transcript.displayItems).toEqual([]);
    expect(stateStore.getState().transcript.historyCursor).toBeNull();
    expect(stateStore.getState().transcript.loadingHistory).toBe(false);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("applies an already returned latest turns page without requesting history", () => {
    const threadTurnsList = vi.fn();
    const { loader, stateStore } = historyFixture({ threadTurnsList });

    const applied = loader.applyLatestPage("thread", threadTurnsResponse([turnFixture([assistantMessage("assistant", "Ready")])], "older"));

    expect(applied).toBe(true);
    expect(threadTurnsList).not.toHaveBeenCalled();
    expect(stateStore.getState().transcript.displayItems).toEqual([
      expect.objectContaining({ id: "assistant", text: "Ready", turnId: "turn" }),
    ]);
    expect(stateStore.getState().transcript.historyCursor).toBe("older");
  });

  it("ignores already returned latest turns pages for stale threads", () => {
    const { loader, stateStore } = historyFixture({ threadTurnsList: vi.fn() });

    const applied = loader.applyLatestPage("other", threadTurnsResponse([turnFixture([assistantMessage("assistant", "Stale")])], "older"));

    expect(applied).toBe(false);
    expect(stateStore.getState().transcript.displayItems).toEqual([]);
    expect(stateStore.getState().transcript.historyCursor).toBeNull();
  });

  it("loads older history without coupling transcript replacement to bottom pin state", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue(threadTurnsResponse([turnFixture([assistantMessage("older", "Older")])], "next"));
    const { loader, stateStore, dispatch, keepCurrentScrollPosition } = historyFixture({ threadTurnsList });
    stateStore.dispatch({ type: "transcript/items-replaced", items: [message("current", "Current")], historyCursor: "cursor" });

    await loader.loadOlder();

    expect(threadTurnsList).toHaveBeenCalledWith("thread", "cursor", 20);
    expect(stateStore.getState().transcript.displayItems.map((item) => item.id)).toEqual(["older", "current"]);
    expect(stateStore.getState().transcript.historyCursor).toBe("next");
    expect(keepCurrentScrollPosition).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "transcript/items-replaced" }));
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
  const loader = new ThreadHistoryController({
    stateStore,
    currentClient: () =>
      ({
        threadTurnsList: options.threadTurnsList,
      }) as unknown as AppServerClient,
    render: vi.fn(),
    addSystemMessage,
    keepCurrentScrollPosition,
    setThreadTurnPresence: vi.fn(),
  });
  return { loader, stateStore, addSystemMessage, dispatch, keepCurrentScrollPosition };
}

function threadTurnsResponse(data: Turn[], nextCursor: string | null): ThreadTurnsListResponse {
  return { data, nextCursor, backwardsCursor: null };
}

function turnFixture(items: ThreadItem[]): Turn {
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

function assistantMessage(id: string, text: string): ThreadItem {
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
