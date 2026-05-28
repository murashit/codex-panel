import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { ThreadHistoryLoader } from "../../../src/features/chat/thread-history";
import type { AppServerClient } from "../../../src/app-server/client";
import type { ThreadItem } from "../../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";

describe("ThreadHistoryLoader", () => {
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

    expect(stateStore.getState().historyCursor).toBe("second-cursor");
    expect(stateStore.getState().loadingHistory).toBe(false);
  });

  it("ignores a history load that is invalidated while pending", async () => {
    const pending = deferred<ThreadTurnsListResponse>();
    const { loader, stateStore, addSystemMessage } = historyFixture({
      threadTurnsList: vi.fn().mockReturnValue(pending.promise),
    });

    const loading = loader.loadLatest();
    expect(stateStore.getState().loadingHistory).toBe(true);

    loader.invalidate();
    pending.resolve(threadTurnsResponse([turnFixture([assistantMessage("assistant", "Stale")])], "stale-cursor"));
    await loading;

    expect(stateStore.getState().displayItems).toEqual([]);
    expect(stateStore.getState().historyCursor).toBeNull();
    expect(stateStore.getState().loadingHistory).toBe(false);
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

type ThreadTurnsListResponse = Awaited<ReturnType<AppServerClient["threadTurnsList"]>>;

function historyFixture(options: { threadTurnsList: ReturnType<typeof vi.fn> }) {
  const state = createChatState();
  state.activeThreadId = "thread";
  const stateStore = createChatStateStore(state);
  const addSystemMessage = vi.fn();
  const loader = new ThreadHistoryLoader({
    stateStore,
    currentClient: () =>
      ({
        threadTurnsList: options.threadTurnsList,
      }) as unknown as AppServerClient,
    render: vi.fn(),
    addSystemMessage,
    forceMessagesToBottom: vi.fn(),
    keepCurrentScrollPosition: vi.fn(),
    setThreadTurnPresence: vi.fn(),
  });
  return { loader, stateStore, addSystemMessage };
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
