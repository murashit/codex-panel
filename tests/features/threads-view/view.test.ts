// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnRecord } from "../../../src/app-server/protocol/turn";
import type { ObservedPaginatedResult } from "../../../src/app-server/query/observed-result";
import type * as ThreadTitleGeneratorModule from "../../../src/app-server/services/thread-title-generation";
import type { Thread } from "../../../src/domain/threads/model";
import { createThreadOperationsTransport, createThreadTitleTransport } from "../../../src/features/threads/app-server/workflow-transports";
import type { ThreadsViewHost } from "../../../src/features/threads-view/session";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { createKeyedOperationQueue } from "../../../src/shared/runtime/keyed-operation-queue";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connected: false,
    connectCalls: 0,
    onExit: null as (() => void) | null,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connected = false;
      state.connectCalls = 0;
      state.onExit = null;
    },
  };
});

const namingMock = vi.hoisted(() => ({
  generateThreadTitleWithCodex: vi.fn(),
}));

vi.mock("../../../src/app-server/connection/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    connect(handlers: { onExit: () => void }): Promise<unknown> {
      connectionMock.state.onExit = handlers.onExit;
      connectionMock.state.connectCalls += 1;
      connectionMock.state.connected = true;
      return Promise.resolve({
        userAgent: "codex-test",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      });
    }

    currentClient(): unknown {
      return connectionMock.state.connected ? connectionMock.state.client : null;
    }

    isConnected(): boolean {
      return connectionMock.state.connected;
    }

    disconnect(): void {
      connectionMock.state.connected = false;
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

vi.mock("../../../src/app-server/services/thread-title-generation", async (importOriginal) => {
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
          loadActive: vi.fn().mockResolvedValue([returned]),
          refreshActive: vi.fn().mockResolvedValue([returned]),
          observeActive: vi.fn((listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
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
          refreshActive: vi.fn(async () => [first]),
          hasMoreActive: vi.fn(() => hasMore),
          loadMoreActive,
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
          activeSnapshot: vi.fn(() => [first]),
          loadActive: vi.fn().mockResolvedValue([first]),
          hasMoreActive: vi.fn(() => true),
          loadMoreActive,
        },
      }),
    );

    view.containerEl.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more")?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Load more failed."));

    expect(view.containerEl.textContent).toContain("First page");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("refreshes thread lists through the plugin coordinator", async () => {
    const threads = [{ id: "thread", preview: "Thread preview", name: null, archived: false, createdAt: 1, updatedAt: 1 }];
    const refresh = vi.fn().mockResolvedValue(threads);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn(),
    });
    const host = threadsHost({
      threadCatalog: {
        refreshActive: refresh,
      },
    });
    const view = await threadsView(host);

    await view.refresh();

    expect(refresh).toHaveBeenCalledOnce();
    expect(view.containerEl.textContent).toContain("Thread preview");
  });

  it("renders cached thread lists before refreshing", async () => {
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn(
        () =>
          new Promise(() => {
            // Keep the app-server refresh pending so the cached snapshot remains visible for this assertion.
          }),
      ),
    });
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          activeSnapshot: vi.fn(() => [threadFixture({ id: "cached", preview: "Cached thread" })]),
        },
      }),
    );

    expect(view.containerEl.textContent).toContain("Cached thread");
  });

  it("keeps successful empty thread lists as last-known-good observed values", async () => {
    let observedThreads!: (result: ObservedPaginatedResult<readonly Thread[]>) => void;
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          refreshActive: vi.fn(
            () =>
              new Promise(() => {
                // Keep the initial refresh pending; this test drives observed query results directly.
              }),
          ),
          observeActive: vi.fn((listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
            observedThreads = listener;
            return () => undefined;
          }),
        },
      }),
    );

    observedThreads(queryResult([]));
    observedThreads(queryResult<readonly Thread[]>(null, new Error("boom")));

    expect(view.containerEl.textContent).toContain("No threads");
    expect(view.containerEl.textContent).not.toContain("boom");
  });

  it("keeps observed refresh failures out of an existing thread list", async () => {
    let observedThreads!: (result: ObservedPaginatedResult<readonly Thread[]>) => void;
    const existing = threadFromRecord(threadFixture({ id: "existing", preview: "Existing thread" }));
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          loadActive: vi.fn(
            () =>
              new Promise(() => {
                // Drive the shared query state directly.
              }),
          ),
          observeActive: vi.fn((listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
            observedThreads = listener;
            return () => undefined;
          }),
        },
      }),
    );

    observedThreads(queryResult([existing]));
    observedThreads(queryResult([existing], new Error("Background refresh failed.")));

    expect(view.containerEl.textContent).toContain("Existing thread");
    expect(view.containerEl.textContent).not.toContain("Background refresh failed.");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("publishes an archive catalog event without closing panel leaves", async () => {
    const archiveThread = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/archive": archiveThread,
    });
    const applyThreadCatalogEvent = vi.fn();
    const host = threadsHost({
      threadCatalog: { apply: applyThreadCatalogEvent },
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();

    await waitForAsyncWork(() => {
      expect(archiveThread).toHaveBeenCalledWith({ threadId: "thread" });
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-archived",
        threadId: "thread",
      });
    });
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

  it("notifies open panels after renaming a thread", async () => {
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": renameThreadRequest,
    });
    const applyThreadCatalogEvent = vi.fn();
    const host = threadsHost({
      threadCatalog: { apply: applyThreadCatalogEvent },
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    changeInputValue(input, "  Renamed   thread  ");
    view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.dispatchEvent(new FocusEvent("blur"));

    await waitForAsyncWork(() => {
      expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Renamed thread" });
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-renamed",
        threadId: "thread",
        name: "Renamed thread",
      });
    });
  });

  it("keeps the rename editor locked until a save finishes", async () => {
    const saved = deferred<object>();
    const renameThreadRequest = vi.fn(() => saved.promise);
    connectionMock.state.client = clientFixture({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      "thread/name/set": renameThreadRequest,
    });
    const applyThreadCatalogEvent = vi.fn();
    const host = threadsHost({
      threadCatalog: { apply: applyThreadCatalogEvent },
    });
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

    await waitForAsyncWork(() => {
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-renamed",
        threadId: "thread",
        name: "Saved title",
      });
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")).toBeNull();
    });
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
          { type: "agentMessage", id: "a1", text: "rename UIを調整しました。", phase: "final_answer", memoryCitation: null },
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
          { type: "agentMessage", id: "a1", text: "Done.", phase: "final_answer", memoryCitation: null },
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
          { type: "agentMessage", id: "a1", text: "Handled.", phase: "final_answer", memoryCitation: null },
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
            { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
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
          { type: "agentMessage", id: "a1", text: "Handled.", phase: "final_answer", memoryCitation: null },
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
  const hostOverrides = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "threadCatalog"));
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
  return {
    settings: {
      archiveExportEnabled: () => DEFAULT_SETTINGS.archiveExportEnabled,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: DEFAULT_SETTINGS.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: DEFAULT_SETTINGS.archiveExportFilenameTemplate,
        archiveExportTags: DEFAULT_SETTINGS.archiveExportTags,
      }),
    },
    vaultPath: "/vault",
    threadNameMutations: createKeyedOperationQueue(),
    threadOperationsTransport: createThreadOperationsTransport(clientAccess),
    threadTitleTransport: createThreadTitleTransport({
      clientAccess,
      codexPath: "codex",
      vaultPath: "/vault",
      threadNamingModel: () => DEFAULT_SETTINGS.threadNamingModel,
      threadNamingEffort: () => DEFAULT_SETTINGS.threadNamingEffort,
      runner: vi.fn(() => Promise.reject(new Error("Unexpected structured turn."))),
    }),
    openNewPanel: vi.fn().mockResolvedValue(undefined),
    openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    openPanelActivities: vi.fn(() => []),
    threadCatalog: {
      apply: vi.fn(),
      hasMoreActive:
        typeof threadCatalogOverrides["hasMoreActive"] === "function" ? threadCatalogOverrides["hasMoreActive"] : vi.fn(() => false),
      ...threadCatalogOverrides,
      loadMoreActive: vi.fn(async () => {
        const load = threadCatalogOverrides["loadMoreActive"];
        const threads = typeof load === "function" ? await load() : [];
        emitActive(threads);
        return threads;
      }),
      loadActive: vi.fn(async () => {
        const load = threadCatalogOverrides["loadActive"];
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
      refreshActive: vi.fn(async () => {
        const refresh = threadCatalogOverrides["refreshActive"];
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
      activeSnapshot:
        typeof threadCatalogOverrides["activeSnapshot"] === "function" ? threadCatalogOverrides["activeSnapshot"] : vi.fn(() => null),
      recentActiveSnapshot:
        typeof threadCatalogOverrides["recentActiveSnapshot"] === "function"
          ? threadCatalogOverrides["recentActiveSnapshot"]
          : vi.fn(() => null),
      observeActive:
        typeof threadCatalogOverrides["observeActive"] === "function"
          ? threadCatalogOverrides["observeActive"]
          : vi.fn((observer: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
              activeObservers.add(observer);
              return () => activeObservers.delete(observer);
            }),
    },
    ...hostOverrides,
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
        runtimeView.activateRuntime();
      },
      detachThreadsView: (runtimeView) => {
        runtimeView.detachRuntime();
      },
    },
  );
  await view.onOpen();
  return view;
}

function threadFromRecord(record: Record<string, unknown>): Thread {
  return {
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
