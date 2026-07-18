// @vitest-environment jsdom

import { SuggestModal } from "obsidian";
import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { openThreadPicker, type ThreadPickerHost } from "../../../src/features/thread-picker/modal.obsidian";

describe("threadPickerSuggestions", () => {
  it("orders title and id prefix matches before looser matches", async () => {
    const modal = await openedThreadPicker([
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
    ]);
    const suggestions = await modal.getSuggestions("alpha");

    expect(suggestions.map((item) => item.thread.id)).toEqual(["alpha-thread", "thread-beta", "thread-alpha"]);
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

  it("uses a modal-local inventory when the shared recent list is cold", async () => {
    const host = threadPickerHost([], [thread({ id: "thread" })], false);
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

interface ThreadSuggestion {
  thread: Thread;
  title: string;
}

interface CapturedThreadPickerModal {
  getSuggestions(query: string): Promise<ThreadSuggestion[]>;
  onChooseSuggestion(item: ThreadSuggestion, evt: MouseEvent | KeyboardEvent): void;
}

async function openedThreadPicker(input: readonly Thread[] | TestThreadPickerHost): Promise<CapturedThreadPickerModal> {
  const captured: CapturedThreadPickerModal[] = [];
  const originalOpen = Object.getOwnPropertyDescriptor(SuggestModal.prototype, "open");
  SuggestModal.prototype.open = function captureOpen(this: SuggestModal<ThreadSuggestion>): void {
    captured.push(this as CapturedThreadPickerModal);
  };
  try {
    await openThreadPicker(isThreadPickerHost(input) ? input : threadPickerHost(input));
  } finally {
    if (originalOpen) Object.defineProperty(SuggestModal.prototype, "open", originalOpen);
  }
  const modal = captured[0];
  if (!modal) throw new Error("Expected thread picker modal to open");
  return modal;
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
      activeSnapshot: () => (hasSharedSnapshot ? firstPage : null),
      loadActive: async () => {
        host.completeHistoryLoads += 1;
        return completeHistory;
      },
      refreshActive: async () => {
        host.sharedRefreshes += 1;
        return firstPage;
      },
      observeActive: () => () => undefined,
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
