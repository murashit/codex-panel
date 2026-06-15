// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { TurnRecord } from "../../../src/app-server/protocol/turn";
import type { Thread } from "../../../src/domain/threads/model";
import type * as ThreadTitleGeneratorModule from "../../../src/app-server/services/thread-title-generation";
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
    connectionMock.reset();
    namingMock.generateThreadTitleWithCodex.mockReset();
  });

  it("uses a distinct thread view icon", async () => {
    const view = await threadsView();

    expect(view.getIcon()).toBe("list-video");
  });

  it("renders thread list from app-server history", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost();
    const view = await threadsView(host);

    await view.refresh();

    expect(connectionMock.state.connectCalls).toBe(1);
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
      listThreads,
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

  it("ignores stale refresh results after the app-server exits", async () => {
    const threads = deferred<unknown>();
    const listThreads = vi.fn(() => threads.promise);
    connectionMock.state.client = clientFixture({
      listThreads,
    });
    const view = await threadsView();

    const refresh = view.refresh();
    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalled();
    });
    connectionMock.state.onExit?.();
    threads.resolve({ data: [threadFixture({ id: "thread", preview: "Late thread" })] });
    await refresh;

    expect(view.containerEl.textContent).toContain("Codex app-server stopped.");
    expect(view.containerEl.textContent).not.toContain("Late thread");
  });

  it("ignores stale refresh results when a newer refresh completes first", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const listThreads = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    connectionMock.state.client = clientFixture({
      listThreads,
    });
    const view = await threadsView();

    const firstRefresh = view.refresh();
    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalledTimes(1);
    });
    const secondRefresh = view.refresh();
    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalledTimes(2);
    });

    resolveSecond({ data: [threadFixture({ id: "second", preview: "Second thread" })] });
    await secondRefresh;
    expect(view.containerEl.textContent).toContain("Second thread");

    resolveFirst({ data: [threadFixture({ id: "first", preview: "First thread" })] });
    await firstRefresh;
    expect(view.containerEl.textContent).toContain("Second thread");
    expect(view.containerEl.textContent).not.toContain("First thread");
  });

  it("opens selected threads through the shared panel selection path", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
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
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
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
    connectionMock.state.client = clientFixture({ listThreads });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Refresh threads"]')?.click();

    await waitForAsyncWork(() => {
      expect(listThreads).toHaveBeenCalledTimes(2);
    });
  });

  it("refreshes thread lists through the plugin coordinator", async () => {
    const threads = [{ id: "thread", preview: "Thread preview", name: null, archived: false, createdAt: 1, updatedAt: 1 }];
    const refreshActiveThreads = vi.fn().mockResolvedValue(threads);
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn(),
    });
    const host = threadsHost({
      threadCatalog: {
        refreshActiveThreads,
      },
    });
    const view = await threadsView(host);

    await view.refresh();

    expect(refreshActiveThreads).toHaveBeenCalledOnce();
    expect(view.containerEl.textContent).toContain("Thread preview");
  });

  it("renders cached thread lists before refreshing", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn(
        () =>
          new Promise(() => {
            // Keep the app-server refresh pending so the cached snapshot remains visible for this assertion.
          }),
      ),
    });
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          activeThreadsSnapshot: vi.fn(() => [threadFixture({ id: "cached", preview: "Cached thread" })]),
        },
      }),
    );

    await view.onOpen();

    expect(view.containerEl.textContent).toContain("Cached thread");
  });

  it("notifies open panels after archiving a thread", async () => {
    const archiveThread = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      archiveThread,
    });
    const archiveThreadInCatalog = vi.fn();
    const host = threadsHost({
      threadCatalog: { archiveThreadInCatalog },
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();

    await waitForAsyncWork(() => {
      expect(archiveThread).toHaveBeenCalledWith("thread");
      expect(archiveThreadInCatalog).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
    });
  });

  it("notifies open panels after renaming a thread", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      setThreadName,
    });
    const renameThreadInCatalog = vi.fn();
    const host = threadsHost({
      threadCatalog: { renameThreadInCatalog },
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
      expect(setThreadName).toHaveBeenCalledWith("thread", "Renamed thread");
      expect(renameThreadInCatalog).toHaveBeenCalledWith("thread", "Renamed thread");
    });
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
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    await waitForAsyncWork(() => {
      expect(threadTurnsList).toHaveBeenCalledWith("thread", null, 20, "asc");
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Threads rename UI");
    });
  });

  it("keeps a manually edited rename draft when threads view auto-name finishes later", async () => {
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
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      threadTurnsList,
    });
    const view = await threadsView();

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
    });

    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    changeInputValue(input, "Manual title");
    generatedTitle.resolve("Generated title");

    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Manual title");
    });
  });
});

function clientFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listThreads: vi.fn().mockResolvedValue({ data: [] }),
    archiveThread: vi.fn().mockResolvedValue({}),
    setThreadName: vi.fn().mockResolvedValue({}),
    threadTurnsList: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    rejectServerRequest: vi.fn(),
    ...overrides,
  };
}

function threadsHost(overrides: Record<string, unknown> = {}) {
  const threadCatalogOverrides =
    "threadCatalog" in overrides && typeof overrides["threadCatalog"] === "object" ? overrides["threadCatalog"] : {};
  const hostOverrides = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "threadCatalog"));
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      codexPath: "codex",
    },
    vaultPath: "/vault",
    openNewPanel: vi.fn().mockResolvedValue(undefined),
    openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    getOpenPanelSnapshots: vi.fn(() => []),
    threadCatalog: {
      archiveThreadInCatalog: vi.fn(),
      renameThreadInCatalog: vi.fn(),
      refreshActiveThreads: vi.fn(async () => {
        const client = connectionMock.state.client;
        if (!client) return [];
        const listThreads = client["listThreads"] as (
          cwd: string,
          options: Record<string, unknown>,
        ) => Promise<{
          data: Record<string, unknown>[];
        }>;
        const response = await listThreads("/vault", { archived: false, cursor: null, limit: 100 });
        return response.data.map(threadFromRecord);
      }),
      activeThreadsSnapshot: vi.fn(() => null),
      observeActiveThreadsResult: vi.fn(() => () => undefined),
      ...threadCatalogOverrides,
    },
    ...hostOverrides,
  };
}

async function threadsView(host = threadsHost()) {
  const { CodexThreadsView } = await import("../../../src/features/threads-view/view");
  const containerEl = document.createElement("div");
  return new CodexThreadsView(
    {
      app: {
        vault: {
          adapter: {},
        },
      },
      containerEl,
    } as never,
    host,
  );
}

function threadFromRecord(record: Record<string, unknown>): Thread {
  return {
    id: String(record["id"]),
    preview: typeof record["preview"] === "string" ? record["preview"] : "",
    name: typeof record["name"] === "string" ? record["name"] : null,
    archived: false,
    createdAt: Number(record["createdAt"] ?? 0),
    updatedAt: Number(record["updatedAt"] ?? 0),
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
