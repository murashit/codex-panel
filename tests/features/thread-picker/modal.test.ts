// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { SuggestModal } from "obsidian";

import type { Thread } from "../../../src/domain/threads/model";
import { openThreadPicker, type ThreadPickerHost } from "../../../src/features/thread-picker/modal";

describe("threadPickerSuggestions", () => {
  it("orders title and id prefix matches before looser matches", async () => {
    const modal = await openedThreadPicker([
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
    ]);
    const suggestions = modal.getSuggestions("alpha");

    expect(suggestions.map((item) => item.thread.id)).toEqual(["alpha-thread", "thread-beta", "thread-alpha"]);
  });

  it("uses updated time for empty queries", async () => {
    const modal = await openedThreadPicker([thread({ id: "older", updatedAt: 10 }), thread({ id: "newer", updatedAt: 20 })]);
    const suggestions = modal.getSuggestions("");

    expect(suggestions.map((item) => item.thread.id)).toEqual(["newer", "older"]);
  });

  it("returns every matching thread", async () => {
    const modal = await openedThreadPicker(
      Array.from({ length: 25 }, (_, index) => thread({ id: `thread-${String(index + 1)}`, name: "Match" })),
    );
    const suggestions = modal.getSuggestions("match");

    expect(suggestions).toHaveLength(25);
  });
});

describe("threadOpenModeFromEvent", () => {
  it("uses the current panel for plain Enter or mouse selection", async () => {
    const host = threadPickerHost([thread({ id: "thread" })]);
    const modal = await openedThreadPicker(host);

    modal.onChooseSuggestion(firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter" }));
    modal.onChooseSuggestion(firstSuggestion(modal), new MouseEvent("click"));

    expect(host.openedCurrent).toEqual(["thread", "thread"]);
    expect(host.openedAvailable).toEqual([]);
  });

  it("uses an available panel for Cmd/Ctrl+Enter", async () => {
    const host = threadPickerHost([thread({ id: "thread" })]);
    const modal = await openedThreadPicker(host);

    modal.onChooseSuggestion(firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    modal.onChooseSuggestion(firstSuggestion(modal), new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));

    expect(host.openedCurrent).toEqual([]);
    expect(host.openedAvailable).toEqual(["thread", "thread"]);
  });
});

interface ThreadSuggestion {
  thread: Thread;
  title: string;
}

interface CapturedThreadPickerModal {
  getSuggestions(query: string): ThreadSuggestion[];
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

function firstSuggestion(modal: CapturedThreadPickerModal): ThreadSuggestion {
  const suggestion = modal.getSuggestions("")[0];
  if (!suggestion) throw new Error("Expected thread picker suggestion");
  return suggestion;
}

function isThreadPickerHost(input: readonly Thread[] | TestThreadPickerHost): input is TestThreadPickerHost {
  return "threadCatalog" in input;
}

interface TestThreadPickerHost extends ThreadPickerHost {
  openedCurrent: string[];
  openedAvailable: string[];
}

function threadPickerHost(threads: readonly Thread[]): TestThreadPickerHost {
  const openedCurrent: string[] = [];
  const openedAvailable: string[] = [];
  return {
    app: {} as never,
    settings: { codexPath: "codex" } as never,
    vaultPath: "/vault",
    openedCurrent,
    openedAvailable,
    threadCatalog: {
      activeThreadsSnapshot: () => threads,
      fetchActiveThreads: async () => threads,
    },
    openThreadInCurrentView: async (threadId) => {
      openedCurrent.push(threadId);
    },
    openThreadInAvailableView: async (threadId) => {
      openedAvailable.push(threadId);
    },
  };
}

function thread(options: Partial<Thread> & { id: string }): Thread {
  return {
    id: options.id,
    preview: options.preview ?? options.id,
    createdAt: options.createdAt ?? 1,
    updatedAt: options.updatedAt ?? 1,
    name: options.name ?? null,
    archived: false,
  };
}
