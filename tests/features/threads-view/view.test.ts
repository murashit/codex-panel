// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnRecord } from "../../../src/app-server/protocol/turn";
import type { Thread } from "../../../src/domain/threads/model";
import type * as ThreadTitleGeneratorModule from "../../../src/features/threads/app-server/thread-title-generation";
import { createThreadMutationAdapter, createThreadTitleAdapter } from "../../../src/features/threads/app-server/workflow-adapters";
import type { ThreadFactSink } from "../../../src/features/threads/workflows/thread-facts";
import { createThreadMutationCommands } from "../../../src/features/threads/workflows/thread-mutation-commands";
import { createThreadReplacementPublication } from "../../../src/features/threads/workflows/thread-replacement-publication";
import type { ThreadsViewHost } from "../../../src/features/threads-view/session";
import type { ThreadsViewPanelActivity } from "../../../src/features/threads-view/state";
import { DEFAULT_SETTINGS } from "../../../src/settings/preferences";
import type { ObservedPaginatedResult } from "../../../src/shared/async/observed-result";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
  };

  return {
    state,
    reset(): void {
      state.client = null;
    },
  };
});

const namingMock = vi.hoisted(() => ({
  generateThreadTitleWithCodex: vi.fn(),
}));

vi.mock("../../../src/features/threads/app-server/thread-title-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof ThreadTitleGeneratorModule>();
  return {
    ...actual,
    generateThreadTitleWithCodex: namingMock.generateThreadTitleWithCodex,
  };
});

installObsidianDomShims();

describe("CodexThreadsView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
    namingMock.generateThreadTitleWithCodex.mockReset();
  });

  it("renders thread list from app-server history", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost();
    const view = await threadsView(host);

    await view.refresh();

    expect(view.containerEl.textContent).toContain("Thread preview");
  });

  it("ignores stale refresh results after close", async () => {
    let resolveThreads!: (value: unknown) => void;
    const listThreads = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveThreads = resolve;
        }),
    );
    connectionMock.state.client = clientFixture({
      "thread/list": listThreads,
    });
    const view = await threadsView();

    const refresh = view.refresh();
    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalled();
    });
    await view.onClose();
    resolveThreads({ data: [threadFixture({ id: "thread", preview: "Late thread" })] });
    await refresh;

    expect(view.containerEl.textContent).not.toContain("Late thread");
  });

  it("renders shared thread refresh failures", async () => {
    const listThreads = vi.fn().mockRejectedValue(new Error("Codex app-server stopped."));
    connectionMock.state.client = clientFixture({
      "thread/list": listThreads,
    });
    const view = await threadsView();

    await view.refresh();

    const status = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__status");
    expect(status?.textContent).toContain("Codex app-server stopped.");
    expect(status?.classList.contains("codex-panel-ui__nav-item")).toBe(false);
    expect(view.containerEl.querySelector(".codex-panel-threads__empty")).toBeNull();
  });

  it("keeps existing threads and notifies when an explicit refresh fails", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [threadFixture({ id: "thread", preview: "Cached thread" })] })
      .mockRejectedValueOnce(new Error("Refresh failed."));
    connectionMock.state.client = clientFixture({ "thread/list": listThreads });
    const view = await threadsView();
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Cached thread"));

    await view.refresh();

    expect(view.containerEl.textContent).toContain("Cached thread");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(notices).toContain("Refresh failed.");
  });

  it("uses the shared query observer as the authoritative list projection", async () => {
    let observer!: (result: ObservedPaginatedResult<readonly Thread[]>) => void;
    const returned = threadFromRecord(threadFixture({ id: "returned", preview: "Returned directly" }));
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          fetchActiveThreads: vi.fn().mockResolvedValue([returned]),
          refreshActiveThreads: vi.fn().mockResolvedValue([returned]),
          observeActiveThreadsResult: vi.fn((listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
            observer = listener;
            return () => undefined;
          }),
        },
      }),
    );

    await view.refresh();
    expect(view.containerEl.textContent).not.toContain("Returned directly");

    observer(queryResult([threadFromRecord(threadFixture({ id: "observed", preview: "Observed thread" }))]));
    expect(view.containerEl.textContent).toContain("Observed thread");
  });

  it("opens selected threads through the shared panel selection path", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost({
      openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    });
    const view = await threadsView(host);

    await view.refresh();
    const row = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row");
    const rowMain = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row-main");
    expect(row?.getAttribute("aria-label")).toBeNull();
    rowMain?.click();

    await waitForAsyncWork(() => {
      expect(host.openThreadInAvailableView).toHaveBeenCalledWith("thread");
    });
  });

  it("keeps archive confirmation through title pointerdown, then clears it before navigation", async () => {
    const opened = deferred<void>();
    const archiveThread = vi.fn().mockResolvedValue({});
    let archiveConfirmVisibleWhenOpening: boolean | null = null;
    let view!: Awaited<ReturnType<typeof threadsView>>;
    const openThreadInAvailableView = vi.fn(() => {
      view.refreshSettings();
      archiveConfirmVisibleWhenOpening = view.containerEl.querySelector(".codex-panel-threads__archive-confirm") !== null;
      return opened.promise;
    });
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": archiveThread,
    });
    view = await threadsView(threadsHost({ openThreadInAvailableView }));
    document.body.append(view.containerEl);

    try {
      await view.refresh();
      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      const title = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row-title");
      expect(title).not.toBeNull();
      if (!title) return;

      title.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
      title.click();

      expect(openThreadInAvailableView).toHaveBeenCalledWith("thread");
      expect(archiveConfirmVisibleWhenOpening).toBe(false);
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).toBeNull();

      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).toBeNull();

      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      const archiveWithoutSaving = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]');
      expect(archiveWithoutSaving).not.toBeNull();
      if (!archiveWithoutSaving) return;
      archiveWithoutSaving.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
      archiveWithoutSaving.click();

      await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledWith({ threadId: "thread" }));
      expect(openThreadInAvailableView).toHaveBeenCalledOnce();
    } finally {
      opened.resolve(undefined);
      await view.onClose();
      view.containerEl.remove();
    }
  });

  it("opens a new panel from the threads view toolbar", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost({
      openNewPanel: vi.fn().mockResolvedValue(undefined),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Open new panel"]')?.click();

    await waitForAsyncWork(() => {
      expect(host.openNewPanel).toHaveBeenCalledOnce();
    });
    expect(host.openThreadInAvailableView).not.toHaveBeenCalled();
  });

  it("refreshes threads from the threads view toolbar", async () => {
    const listThreads = vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] });
    connectionMock.state.client = clientFixture({ "thread/list": listThreads });
    const view = await threadsView();

    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Refresh threads"]')?.click();

    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalledTimes(2);
    });
  });

  it("loads another thread page only after the user requests it", async () => {
    const first = threadFromRecord(threadFixture({ id: "first", preview: "First page" }));
    const second = threadFromRecord(threadFixture({ id: "second", preview: "Second page" }));
    let hasMore = true;
    const loadMoreActive = vi.fn(async () => {
      hasMore = false;
      return [first, second];
    });
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          refreshActiveThreads: vi.fn(async () => [first]),
          hasMoreActiveThreads: vi.fn(() => hasMore),
          loadMoreActiveThreads: loadMoreActive,
        },
      }),
    );

    await view.refresh();
    expect(view.containerEl.textContent).toContain("First page");
    expect(view.containerEl.textContent).not.toContain("Second page");

    view.containerEl.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more")?.click();
    await waitForAsyncWork(() => {
      expect(loadMoreActive).toHaveBeenCalledOnce();
      expect(view.containerEl.textContent).toContain("Second page");
    });
    expect(view.containerEl.querySelector(".codex-panel-threads__load-more")).toBeNull();
  });

  it("keeps existing threads and notifies when loading another page fails", async () => {
    const first = threadFromRecord(threadFixture({ id: "first", preview: "First page" }));
    const loadMoreActive = vi.fn().mockRejectedValue(new Error("Load more failed."));
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          activeThreadsSnapshot: vi.fn(() => [first]),
          fetchActiveThreads: vi.fn().mockResolvedValue([first]),
          hasMoreActiveThreads: vi.fn(() => true),
          loadMoreActiveThreads: loadMoreActive,
        },
      }),
    );

    view.containerEl.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more")?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Load more failed."));

    expect(view.containerEl.textContent).toContain("First page");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("renders cached thread lists before refreshing", async () => {
    const refresh = vi.fn(
      () =>
        new Promise<readonly Thread[]>(() => {
          // Keep the app-server refresh pending so the cached snapshot remains visible for this assertion.
        }),
    );
    const fetch = vi.fn().mockRejectedValue(new Error("Opening the view must force a refresh."));
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          activeThreadsSnapshot: vi.fn(() => [threadFixture({ id: "cached", preview: "Cached thread" })]),
          fetchActiveThreads: fetch,
          refreshActiveThreads: refresh,
        },
      }),
    );

    expect(view.containerEl.textContent).toContain("Cached thread");
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("archives without closing panel leaves", async () => {
    const archiveThread = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": archiveThread,
    });
    const host = threadsHost();
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();

    await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledWith({ threadId: "thread" }));
  });

  it("lets a completed archive settle after the threads view closes", async () => {
    const archived = deferred<object>();
    const archiveThread = vi.fn(() => archived.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": archiveThread,
    });
    const view = await threadsView(threadsHost());

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();
    await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledWith({ threadId: "thread" }));
    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.disabled).toBe(true);
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();
    expect(archiveThread).toHaveBeenCalledOnce();

    await view.onClose();
    archived.resolve({});
    await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledOnce());
    expect(view.containerEl.childElementCount).toBe(0);
  });

  it("does not archive a thread while its panel is pending or running", async () => {
    const archiveThread = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": archiveThread,
    });
    const view = await threadsView(
      threadsHost({
        openPanelActivities: vi.fn(() => [{ threadId: "thread", selected: false, pending: true, running: false }]),
      }),
    );
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    const archiveButton = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]');
    expect(archiveButton?.disabled).toBe(true);
    archiveButton?.click();
    expect(archiveThread).not.toHaveBeenCalled();
  });

  it("keeps replacement panel activity on a visible row while the catalog observer is delayed", async () => {
    const source = threadFromRecord(threadFixture({ id: "source", preview: "Source" }));
    const replacement = threadFromRecord(threadFixture({ id: "replacement", preview: "Replacement" }));
    let cachedThreads: readonly Thread[] = [source];
    let activities: readonly ThreadsViewPanelActivity[] = [{ threadId: "source", selected: true, pending: false, running: false }];
    const publication = createThreadReplacementPublication((facts) => {
      for (const fact of facts) {
        if (fact.type === "thread-upserted") cachedThreads = [fact.thread, ...cachedThreads.filter((item) => item.id !== fact.thread.id)];
        if (fact.type === "thread-archived") cachedThreads = cachedThreads.filter((item) => item.id !== fact.threadId);
      }
    });
    const pending = publication.begin("source");
    pending.attach(replacement);
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          activeThreadsSnapshot: () => cachedThreads,
          refreshActiveThreads: async () => cachedThreads,
        },
        visiblePanelActivities: (threads: readonly Thread[]) =>
          activities.map((activity) => ({
            ...activity,
            threadId: publication.visibleThreadId(threads, activity.threadId),
          })),
      }),
    );

    activities = [{ threadId: "replacement", selected: true, pending: false, running: false }];
    view.refreshLiveState();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(view.containerEl.querySelector(".codex-panel-threads__row--selected")?.textContent).toContain("Source");

    view.refreshLiveState();
    pending.finish(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(view.containerEl.querySelector(".codex-panel-threads__row--selected")?.textContent).toContain("Replacement");
  });

  it("renames a thread through the shared client", async () => {
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": renameThreadRequest,
    });
    const host = threadsHost();
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    changeInputValue(input, "  Renamed   thread  ");
    view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.dispatchEvent(new FocusEvent("blur"));

    await waitForAsyncWork(() => expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Renamed thread" }));
  });

  it("keeps the rename editor locked until a save finishes", async () => {
    const saved = deferred<object>();
    const renameThreadRequest = vi.fn(() => saved.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": renameThreadRequest,
    });
    const host = threadsHost();
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const firstInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    changeInputValue(firstInput, "  Saved   title  ");
    firstInput.dispatchEvent(new FocusEvent("blur"));
    await waitForAsyncWork(() => {
      expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Saved title" });
    });

    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(true);
    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();

    saved.resolve({});

    await waitForAsyncWork(() => expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")).toBeNull());
  });

  it("restores the same editor when a locked rename save fails", async () => {
    const saved = deferred<object>();
    const renameThreadRequest = vi.fn(() => saved.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": renameThreadRequest,
    });
    const view = await threadsView(threadsHost());

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const firstInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    if (!firstInput) throw new Error("Missing rename input");
    changeInputValue(firstInput, "Saved title");
    firstInput.dispatchEvent(new FocusEvent("blur"));
    await waitForAsyncWork(() => expect(renameThreadRequest).toHaveBeenCalledOnce());

    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(true);

    saved.reject(new Error("Rename failed."));
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Saved title");
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(false);
    expect(notices).toContain("Rename failed.");
  });

  it("notifies a current rename failure without adding list status", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": vi.fn().mockRejectedValue(new Error("Rename failed.")),
    });
    const view = await threadsView();
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    if (!input) throw new Error("Missing rename input");
    changeInputValue(input, "New name");
    input.dispatchEvent(new FocusEvent("blur"));
    await waitForAsyncWork(() => expect(notices).toContain("Rename failed."));

    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("New name");
  });

  it("notifies an archive failure without adding list status", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": vi.fn().mockRejectedValue(new Error("Archive failed.")),
    });
    const view = await threadsView();
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Archive failed."));

    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
  });

  it("auto-names a thread rename draft from completed history", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue({
      data: [
        turnFixture([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "text", text: "threads viewのrenameを直したい", text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: "a1",
            text: "rename UIを調整しました。",
            phase: "final_answer",
            memoryCitation: null,
            delivery: null,
          },
        ]),
      ],
      nextCursor: null,
    });
    namingMock.generateThreadTitleWithCodex.mockResolvedValue("Threads rename UI");
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/turns/list": threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    await waitForAsyncWork(() => {
      expect(threadTurnsList).toHaveBeenCalledWith({
        threadId: "thread",
        cursor: null,
        limit: 20,
        sortDirection: "asc",
        itemsView: "full",
      });
      expect(threadTurnsList).toHaveBeenCalledOnce();
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Threads rename UI");
    });
  });

  it("disables auto-name without publishing an error when completed history is unavailable", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/turns/list": threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(threadTurnsList).toHaveBeenCalledOnce();
    });

    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(view.containerEl.textContent).not.toContain("completed history");
    expect(namingMock.generateThreadTitleWithCodex).not.toHaveBeenCalled();
  });

  it("keeps loading auto-name history while a rename save is in flight", async () => {
    const history = deferred<unknown>();
    const saved = deferred<object>();
    const completedHistory = {
      data: [
        turnFixture([
          { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "Name this", text_elements: [] }] },
          { type: "agentMessage", id: "a1", text: "Done.", phase: "final_answer", memoryCitation: null, delivery: null },
        ]),
      ],
      nextCursor: null,
    };
    const threadTurnsList = vi.fn().mockReturnValue(history.promise);
    namingMock.generateThreadTitleWithCodex.mockResolvedValue("Generated title");
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": vi.fn(() => saved.promise),
      "thread/turns/list": threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => expect(threadTurnsList).toHaveBeenCalledOnce());
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    if (!input) throw new Error("Missing rename input");
    input.dispatchEvent(new FocusEvent("blur"));
    changeInputValue(input, "Changed while saving");
    history.resolve(completedHistory);
    saved.reject(new Error("Rename failed."));

    await waitForAsyncWork(() => {
      expect(threadTurnsList).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    const autoName = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]');
    autoName?.click();
    await waitForAsyncWork(() => {
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Generated title");
    });
  });

  it("replaces the auto-name action with cancellation while generating", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue({
      data: [
        turnFixture([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "text", text: "rename stale handling", text_elements: [] }],
          },
          { type: "agentMessage", id: "a1", text: "Handled.", phase: "final_answer", memoryCitation: null, delivery: null },
        ]),
      ],
      nextCursor: null,
    });
    const generatedTitle = deferred<string | null>();
    namingMock.generateThreadTitleWithCodex.mockReturnValue(generatedTitle.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/turns/list": threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    await waitForAsyncWork(() => {
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')).toBeNull();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]')).not.toBeNull();
    });

    generatedTitle.resolve("Generated title");
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Generated title");
    });
  });

  it("does not remount the threads view when auto-name finishes after close", async () => {
    const generatedTitle = deferred<string | null>();
    namingMock.generateThreadTitleWithCodex.mockReturnValue(generatedTitle.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/turns/list": vi.fn().mockResolvedValue({
        data: [
          turnFixture([
            { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "name this", text_elements: [] }] },
            { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null, delivery: null },
          ]),
        ],
        nextCursor: null,
      }),
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
    });
    const generationSignal = namingMock.generateThreadTitleWithCodex.mock.calls[0]?.[4]?.signal as AbortSignal | undefined;
    await view.onClose();
    expect(generationSignal?.aborted).toBe(true);
    generatedTitle.resolve("Late title");
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.childElementCount).toBe(0);
    expect(view.containerEl.textContent).not.toContain("Late title");
  });

  it("cancels auto-name without applying a late generated title", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue({
      data: [
        turnFixture([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "text", text: "rename stale handling", text_elements: [] }],
          },
          { type: "agentMessage", id: "a1", text: "Handled.", phase: "final_answer", memoryCitation: null, delivery: null },
        ]),
      ],
      nextCursor: null,
    });
    const generatedTitle = deferred<string | null>();
    namingMock.generateThreadTitleWithCodex.mockReturnValue(generatedTitle.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/turns/list": threadTurnsList,
    });
    const view = await threadsView();
    document.body.append(view.containerEl);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
    });

    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.disabled).toBe(true);
    const generationSignal = namingMock.generateThreadTitleWithCodex.mock.calls[0]?.[4]?.signal as AbortSignal | undefined;
    expect(generationSignal?.aborted).toBe(false);
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]')?.click();
    const editableInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(generationSignal?.aborted).toBe(true);
    expect(editableInput?.disabled).toBe(false);
    expect(editableInput?.value).toBe("Thread preview");
    expect(document.activeElement).toBe(editableInput);
    generatedTitle.resolve("Generated title");
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Thread preview");
    expect(view.containerEl.textContent).not.toContain("Generated title");
    view.containerEl.remove();
  });

  it("ignores refresh requests while detached from an execution runtime", async () => {
    const view = await threadsView();
    view.detachRuntime();

    await expect(view.refresh()).resolves.toBeUndefined();
    expect(() => view.refreshLiveState()).not.toThrow();
    expect(() => view.refreshSettings()).not.toThrow();
  });

  it("clears the runtime attachment when closing the session fails", async () => {
    const view = await threadsView();
    const session = (view as unknown as { session: { close(): void } }).session;
    vi.spyOn(session, "close").mockImplementation(() => {
      throw new Error("close failed");
    });

    expect(() => view.detachRuntime()).not.toThrow();
    expect(() => view.refreshLiveState()).not.toThrow();
    await expect(view.refresh()).resolves.toBeUndefined();
  });
});

type ThreadRequestHandler = ReturnType<typeof vi.fn<(params: Record<string, unknown>) => unknown>>;

function clientFixture(overrides: Record<string, ThreadRequestHandler> = {}): Record<string, unknown> {
  const handlers: Record<string, ThreadRequestHandler> = {
    "thread/list": vi.fn().mockResolvedValue({ data: [] }),
    "thread/archive": vi.fn().mockResolvedValue({}),
    "thread/name/set": vi.fn().mockResolvedValue({}),
    "thread/turns/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    ...overrides,
  };
  return {
    request: vi.fn((method: string, params: Record<string, unknown>) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params);
    }),
  };
}

function threadsHost(overrides: Record<string, unknown> = {}) {
  const threadCatalogOverrides: Partial<ThreadsViewHost["threadCatalog"]> =
    "threadCatalog" in overrides && overrides["threadCatalog"] !== null && typeof overrides["threadCatalog"] === "object"
      ? (overrides["threadCatalog"] as Partial<ThreadsViewHost["threadCatalog"]>)
      : {};
  const threadEventOverrides =
    "threadFacts" in overrides && overrides["threadFacts"] !== null && typeof overrides["threadFacts"] === "object"
      ? (overrides["threadFacts"] as Partial<ThreadFactSink>)
      : {};
  const applyThreadFact = threadEventOverrides.apply ?? vi.fn();
  const hostOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => key !== "threadCatalog" && key !== "threadFacts" && key !== "openPanelActivities"),
  );
  const activeObservers = new Set<(result: ObservedPaginatedResult<readonly Thread[]>) => void>();
  const emitActive = (threads: readonly Thread[]): void => {
    for (const observer of activeObservers) observer(queryResult(threads));
  };
  const clientAccess = {
    withClient: async <T>(operation: (client: never) => Promise<T>): Promise<T> => {
      const client = connectionMock.state.client;
      if (!client) throw new Error("No current client.");
      return operation(client as never);
    },
  };
  const openPanelActivities =
    "openPanelActivities" in overrides && typeof overrides["openPanelActivities"] === "function"
      ? (overrides["openPanelActivities"] as () => readonly ThreadsViewPanelActivity[])
      : vi.fn(() => []);
  const threadMutations = createThreadMutationCommands({
    port: createThreadMutationAdapter(clientAccess),
    archiveExport: {
      settings: () => ({
        archiveExportFolderTemplate: DEFAULT_SETTINGS.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: DEFAULT_SETTINGS.archiveExportFilenameTemplate,
        archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
      }),
      enabled: () => DEFAULT_SETTINGS.archiveExportEnabled,
      vaultPath: "/vault",
      vaultConfigDir: ".obsidian",
    },
    archiveDestination: () => ({
      normalizePath: (path) => path,
      exists: vi.fn().mockResolvedValue(false),
      createFolder: vi.fn().mockResolvedValue(undefined),
      createMarkdownFile: vi.fn().mockResolvedValue(undefined),
    }),
    facts: threadFactSink(applyThreadFact),
    referenceThreads: () => [],
    threadIsBusy: (threadId) =>
      openPanelActivities().some((activity) => activity.threadId === threadId && (activity.pending || activity.running)),
  });
  return {
    settings: {
      archiveExportEnabled: () => DEFAULT_SETTINGS.archiveExportEnabled,
    },
    threadMutations,
    threadTitlePort: createThreadTitleAdapter({
      clientAccess,
      codexPath: "codex",
      vaultPath: "/vault",
      threadNamingModel: () => DEFAULT_SETTINGS.threadNamingModel,
      threadNamingEffort: () => DEFAULT_SETTINGS.threadNamingEffort,
      runner: vi.fn(() => Promise.reject(new Error("Unexpected structured turn."))),
    }),
    openNewPanel: vi.fn().mockResolvedValue(undefined),
    openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    visiblePanelActivities: () => openPanelActivities(),
    threadCatalog: {
      hasMoreActiveThreads:
        typeof threadCatalogOverrides["hasMoreActiveThreads"] === "function"
          ? threadCatalogOverrides["hasMoreActiveThreads"]
          : vi.fn(() => false),
      ...threadCatalogOverrides,
      loadMoreActiveThreads: vi.fn(async () => {
        const load = threadCatalogOverrides["loadMoreActiveThreads"];
        const threads = typeof load === "function" ? await load() : [];
        emitActive(threads);
        return threads;
      }),
      fetchActiveThreads: vi.fn(async () => {
        const load = threadCatalogOverrides["fetchActiveThreads"];
        if (typeof load === "function") {
          const threads = await load();
          emitActive(threads);
          return threads;
        }
        const client = connectionMock.state.client;
        if (!client) return [];
        const request = client["request"] as (
          method: string,
          params: Record<string, unknown>,
        ) => Promise<{ data: Record<string, unknown>[] }>;
        const response = await request("thread/list", { cwd: "/vault", archived: false, cursor: null });
        const threads = response.data.map(threadFromRecord);
        emitActive(threads);
        return threads;
      }),
      refreshActiveThreads: vi.fn(async () => {
        const refresh = threadCatalogOverrides["refreshActiveThreads"];
        if (typeof refresh === "function") {
          const threads = await refresh();
          emitActive(threads);
          return threads;
        }
        const client = connectionMock.state.client;
        if (!client) return [];
        const request = client["request"] as (
          method: string,
          params: Record<string, unknown>,
        ) => Promise<{
          data: Record<string, unknown>[];
        }>;
        const response = await request("thread/list", { cwd: "/vault", archived: false, cursor: null });
        const threads = response.data.map(threadFromRecord);
        emitActive(threads);
        return threads;
      }),
      activeThreadsSnapshot:
        typeof threadCatalogOverrides["activeThreadsSnapshot"] === "function"
          ? threadCatalogOverrides["activeThreadsSnapshot"]
          : vi.fn(() => null),
      recentActiveThreadsSnapshot:
        typeof threadCatalogOverrides["recentActiveThreadsSnapshot"] === "function"
          ? threadCatalogOverrides["recentActiveThreadsSnapshot"]
          : vi.fn(() => null),
      observeActiveThreadsResult:
        typeof threadCatalogOverrides["observeActiveThreadsResult"] === "function"
          ? threadCatalogOverrides["observeActiveThreadsResult"]
          : vi.fn((observer: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
              activeObservers.add(observer);
              return () => activeObservers.delete(observer);
            }),
    },
    ...hostOverrides,
  };
}

function threadFactSink(apply: ThreadFactSink["apply"]): ThreadFactSink {
  return {
    apply,
    applyBatch: (facts) => {
      for (const fact of facts) apply(fact);
    },
  };
}

async function threadsView(host = threadsHost()) {
  const { CodexThreadsView } = await import("../../../src/features/threads-view/view.obsidian");
  const containerEl = document.createElement("div");
  const view = new CodexThreadsView(
    {
      app: {
        vault: {
          adapter: {},
        },
      },
      containerEl,
    } as never,
    {
      attachThreadsView: (runtimeView) => {
        runtimeView.attachRuntime(host);
      },
    },
  );
  await view.onOpen();
  return view;
}

function threadFromRecord(record: Record<string, unknown>): Thread {
  return {
    historyMode: "unknown",
    id: String(record["id"]),
    preview: typeof record["preview"] === "string" ? record["preview"] : "",
    name: typeof record["name"] === "string" ? record["name"] : null,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: Number(record["createdAt"] ?? 0),
    updatedAt: Number(record["updatedAt"] ?? 0),
  };
}

function queryResult<T>(value: T | null, error: Error | null = null): ObservedPaginatedResult<T> {
  return {
    value,
    error,
    isFetching: false,
    hasMore: false,
    isFetchingNextPage: false,
  };
}

function threadFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "thread",
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function turnFixture(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    ...overrides,
  };
}
