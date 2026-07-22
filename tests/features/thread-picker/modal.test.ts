// @vitest-environment jsdom

import { SuggestModal } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { openThreadPicker, type ThreadPickerHost } from "../../../src/features/thread-picker/modal.obsidian";

describe("threadPickerSuggestions", () => {
  it("matches titles fuzzily without matching full or short ids", async () => {
    const modal = await openedThreadPicker([
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Project notes", updatedAt: 50 }),
      thread({ id: "fuzzy", name: "Architecture proposal" }),
    ]);

    expect((await modal.getSuggestions("alpha")).map((item) => item.thread.id)).toEqual(["thread-beta", "thread-alpha"]);
    expect((await modal.getSuggestions("019abcde")).map((item) => item.thread.id)).toEqual([]);
    expect((await modal.getSuggestions("ctpr")).map((item) => item.thread.id)).toEqual(["fuzzy"]);
  });

  it("uses recency time for empty queries", async () => {
    const modal = await openedThreadPicker([
      thread({ id: "updated-newer", updatedAt: 20, recencyAt: 10 }),
      thread({ id: "recent", updatedAt: 10, recencyAt: 30 }),
    ]);
    const suggestions = await modal.getSuggestions("");

    expect(suggestions.map((item) => item.thread.id)).toEqual(["recent", "updated-newer"]);
  });

  it("returns every matching thread", async () => {
    const modal = await openedThreadPicker(
      Array.from({ length: 25 }, (_, index) => thread({ id: `thread-${String(index + 1)}`, name: "Match" })),
    );
    const suggestions = await modal.getSuggestions("match");

    expect(suggestions).toHaveLength(25);
  });

  it("loads complete history only when a search needs it", async () => {
    const host = threadPickerHost([thread({ id: "recent" })], [thread({ id: "recent" }), thread({ id: "older-target", name: "Needle" })]);
    const modal = await openedThreadPicker(host);

    expect((await modal.getSuggestions("")).map((item) => item.thread.id)).toEqual(["recent"]);
    expect(host.completeHistoryLoads).toBe(0);
    expect(host.sharedRefreshes).toBe(0);

    const [needleSuggestions] = await Promise.all([modal.getSuggestions("needle"), modal.getSuggestions("target")]);
    expect(needleSuggestions.map((item) => item.thread.id)).toEqual(["older-target"]);
    expect(host.completeHistoryLoads).toBe(1);
  });

  it("uses the native searching empty state until the complete inventory resolves", async () => {
    const pending = deferred<readonly Thread[]>();
    const host = threadPickerHost([thread({ id: "recent" })]);
    host.threadCatalog.fetchActiveThreadSearchInventory = () => pending.promise;
    const modal = await openedThreadPicker(host);

    const suggestions = modal.getSuggestions("needle");

    expect(modal.emptyStateText).toBe("Searching older Codex threads…");
    expect(modal.resultContainerEl.textContent).toBe("Searching older Codex threads…");
    pending.resolve([thread({ id: "older", name: "Needle" })]);
    await expect(suggestions).resolves.toMatchObject([{ thread: { id: "older" } }]);
    expect(modal.emptyStateText).toBe("No matching Codex threads");
  });

  it("clears the searching empty state when the query is cleared", async () => {
    const pending = deferred<readonly Thread[]>();
    const host = threadPickerHost([thread({ id: "recent" })]);
    host.threadCatalog.fetchActiveThreadSearchInventory = () => pending.promise;
    const modal = await openedThreadPicker(host);

    const suggestions = modal.getSuggestions("needle");
    expect(modal.emptyStateText).toBe("Searching older Codex threads…");

    await expect(modal.getSuggestions("")).resolves.toMatchObject([{ thread: { id: "recent" } }]);
    expect(modal.emptyStateText).toBe("No matching Codex threads");

    pending.resolve([]);
    await suggestions;
  });

  it("uses a modal-local inventory when the shared recent list is cold", async () => {
    const threadHistory = [thread({ id: "thread" })];
    const host = threadPickerHost([], threadHistory, threadHistory, false);
    const modal = await openedThreadPicker(host);

    expect((await modal.getSuggestions("")).map((item) => item.thread.id)).toEqual(["thread"]);
    expect((await modal.getSuggestions("thread")).map((item) => item.thread.id)).toEqual(["thread"]);
    expect(host.completeHistoryLoads).toBe(1);
    expect(host.sharedRefreshes).toBe(0);
  });
});

describe("threadOpenModeFromEvent", () => {
  it("uses the current panel for plain Enter or mouse selection", async () => {
    const host = threadPickerHost([thread({ id: "thread" })]);
    const modal = await openedThreadPicker(host);

    modal.onChooseSuggestion(await firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter" }));
    modal.onChooseSuggestion(await firstSuggestion(modal), new MouseEvent("click"));

    expect(host.openedCurrent).toEqual(["thread", "thread"]);
    expect(host.openedAvailable).toEqual([]);
  });

  it("uses an available panel for Cmd/Ctrl+Enter", async () => {
    const host = threadPickerHost([thread({ id: "thread" })]);
    const modal = await openedThreadPicker(host);

    modal.onChooseSuggestion(await firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    modal.onChooseSuggestion(await firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));

    expect(host.openedCurrent).toEqual([]);
    expect(host.openedAvailable).toEqual(["thread", "thread"]);
  });
});

describe("thread picker lifecycle", () => {
  it("reports natural close only once", async () => {
    const onClosed = vi.fn();
    const { controller, modal } = await openedThreadPickerSession([thread({ id: "thread" })], onClosed);

    modal.onClose();
    controller.close();

    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("finishes when the initial inventory is empty", async () => {
    const onClosed = vi.fn();

    openThreadPicker(threadPickerHost([]), onClosed);
    await flushMicrotasks();

    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("finishes when the initial inventory fails to load", async () => {
    const host = threadPickerHost([], [], [], false);
    host.threadCatalog.fetchActiveThreads = async () => {
      throw new Error("inventory unavailable");
    };
    const onClosed = vi.fn();

    openThreadPicker(host, onClosed);
    await flushMicrotasks();

    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("does not open after being replaced during the initial inventory load", async () => {
    const pending = deferred<readonly Thread[]>();
    const host = threadPickerHost([], [], [], false);
    host.threadCatalog.fetchActiveThreads = () => pending.promise;
    const open = vi.spyOn(SuggestModal.prototype, "open");
    const onClosed = vi.fn();

    try {
      const controller = openThreadPicker(host, onClosed);
      await Promise.resolve();
      controller.close();
      pending.resolve([thread({ id: "stale" })]);
      await flushMicrotasks();

      expect(open).not.toHaveBeenCalled();
      expect(onClosed).toHaveBeenCalledOnce();
    } finally {
      open.mockRestore();
    }
  });
});

interface ThreadSuggestion {
  thread: Thread;
  title: string;
}

interface CapturedThreadPickerModal {
  emptyStateText: string;
  resultContainerEl: HTMLElement;
  getSuggestions(query: string): Promise<ThreadSuggestion[]>;
  onClose(): void;
  onChooseSuggestion(item: ThreadSuggestion, evt: MouseEvent | KeyboardEvent): void;
}

async function openedThreadPicker(input: readonly Thread[] | TestThreadPickerHost): Promise<CapturedThreadPickerModal> {
  return (await openedThreadPickerSession(input)).modal;
}

async function openedThreadPickerSession(
  input: readonly Thread[] | TestThreadPickerHost,
  onClosed: () => void = () => undefined,
): Promise<{ controller: ReturnType<typeof openThreadPicker>; modal: CapturedThreadPickerModal }> {
  const captured: CapturedThreadPickerModal[] = [];
  const originalOpen = Object.getOwnPropertyDescriptor(SuggestModal.prototype, "open");
  SuggestModal.prototype.open = function captureOpen(this: SuggestModal<ThreadSuggestion>): void {
    captured.push(this as CapturedThreadPickerModal);
  };
  let controller: ReturnType<typeof openThreadPicker>;
  try {
    controller = openThreadPicker(isThreadPickerHost(input) ? input : threadPickerHost(input), onClosed);
    await flushMicrotasks();
  } finally {
    if (originalOpen) Object.defineProperty(SuggestModal.prototype, "open", originalOpen);
  }
  const modal = captured[0];
  if (!modal) throw new Error("Expected thread picker modal to open");
  return { controller, modal };
}

async function firstSuggestion(modal: CapturedThreadPickerModal): Promise<ThreadSuggestion> {
  const suggestion = (await modal.getSuggestions(""))[0];
  if (!suggestion) throw new Error("Expected thread picker suggestion");
  return suggestion;
}

function isThreadPickerHost(input: readonly Thread[] | TestThreadPickerHost): input is TestThreadPickerHost {
  return "threadCatalog" in input;
}

interface TestThreadPickerHost extends ThreadPickerHost {
  openedCurrent: string[];
  openedAvailable: string[];
  completeHistoryLoads: number;
  sharedRefreshes: number;
}

function threadPickerHost(
  firstPage: readonly Thread[],
  completeHistory: readonly Thread[] = firstPage,
  loadedThreads: readonly Thread[] = firstPage,
  hasSharedSnapshot = true,
): TestThreadPickerHost {
  const openedCurrent: string[] = [];
  const openedAvailable: string[] = [];
  const host: TestThreadPickerHost = {
    app: {} as never,
    openedCurrent,
    openedAvailable,
    completeHistoryLoads: 0,
    sharedRefreshes: 0,
    threadCatalog: {
      activeThreadsSnapshot: () => (hasSharedSnapshot ? firstPage : null),
      recentActiveThreadsSnapshot: () => (hasSharedSnapshot ? firstPage : null),
      fetchActiveThreads: async () => loadedThreads,
      fetchActiveThreadSearchInventory: async () => {
        host.completeHistoryLoads += 1;
        return completeHistory;
      },
      refreshActiveThreads: async () => {
        host.sharedRefreshes += 1;
        return loadedThreads;
      },
      hasMoreActiveThreads: () => false,
      loadMoreActiveThreads: async () => loadedThreads,
      observeActiveThreadsResult: () => () => undefined,
    },
    openThreadInCurrentView: async (threadId) => {
      openedCurrent.push(threadId);
    },
    openThreadInAvailableView: async (threadId) => {
      openedAvailable.push(threadId);
    },
  };
  return host;
}

function thread(options: Partial<Thread> & { id: string }): Thread {
  return {
    id: options.id,
    preview: options.preview ?? options.id,
    createdAt: options.createdAt ?? 1,
    updatedAt: options.updatedAt ?? 1,
    ...(options.recencyAt === undefined ? {} : { recencyAt: options.recencyAt }),
    name: options.name ?? null,
    archived: false,
    provenance: options.provenance ?? { kind: "interactive" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
