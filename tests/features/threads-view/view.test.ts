// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";
import type * as ThreadNamingModule from "../../../src/app-server/thread-naming";
import { installObsidianDomShims } from "../chat/ui/dom-test-helpers";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connected: false,
    connectCalls: 0,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connected = false;
      state.connectCalls = 0;
    },
  };
});

const namingMock = vi.hoisted(() => ({
  generateThreadTitleWithCodex: vi.fn(),
}));

vi.mock("../../../src/app-server/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    connect(): Promise<unknown> {
      connectionMock.state.connectCalls += 1;
      connectionMock.state.connected = true;
      return Promise.resolve({});
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

vi.mock("../../../src/app-server/thread-naming", async (importOriginal) => {
  const actual = await importOriginal<typeof ThreadNamingModule>();
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

  it("renders thread list from app-server history", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const view = await threadsView();

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
    await vi.waitFor(() => {
      expect(listThreads).toHaveBeenCalled();
    });
    await view.onClose();
    resolveThreads({ data: [threadFixture({ id: "thread", preview: "Late thread" })] });
    await refresh;

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
    await vi.waitFor(() => {
      expect(listThreads).toHaveBeenCalledTimes(1);
    });
    const secondRefresh = view.refresh();
    await vi.waitFor(() => {
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
    expect(row?.getAttribute("aria-label")).toBeNull();
    row?.click();

    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
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

    await vi.waitFor(() => {
      expect(listThreads).toHaveBeenCalledTimes(2);
    });
  });

  it("refreshes thread lists through the plugin coordinator", async () => {
    const threads = [threadFixture({ id: "thread", preview: "Thread preview" })];
    const refreshThreadList = vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>);
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: threads }),
    });
    const host = threadsHost({
      refreshThreadList,
    });
    const view = await threadsView(host);

    await view.refresh();

    expect(refreshThreadList).toHaveBeenCalledOnce();
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
        cachedThreadList: vi.fn(() => [threadFixture({ id: "cached", preview: "Cached thread" })]),
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
    const host = threadsHost({
      notifyThreadArchived: vi.fn(),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();

    await vi.waitFor(() => {
      expect(archiveThread).toHaveBeenCalledWith("thread");
      expect(host.notifyThreadArchived).toHaveBeenCalledWith("thread");
    });
  });

  it("notifies open panels after renaming a thread", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
      setThreadName,
    });
    const host = threadsHost({
      notifyThreadRenamed: vi.fn(),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "Renamed thread";
    input.dispatchEvent(new FocusEvent("blur"));

    await vi.waitFor(() => {
      expect(setThreadName).toHaveBeenCalledWith("thread", "Renamed thread");
      expect(host.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed thread");
    });
  });

  it("auto-names a thread rename draft from completed history", async () => {
    const threadTurnsList = vi.fn().mockResolvedValue({
      data: [
        turnFixture([
          { type: "userMessage", id: "u1", content: [{ type: "text", text: "threads viewのrenameを直したい", text_elements: [] }] },
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

    await vi.waitFor(() => {
      expect(threadTurnsList).toHaveBeenCalledWith("thread", null, 20, "asc");
      expect(namingMock.generateThreadTitleWithCodex).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Threads rename UI");
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
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      codexPath: "codex",
    },
    vaultPath: "/vault",
    openNewPanel: vi.fn().mockResolvedValue(undefined),
    openThreadInAvailableView: vi.fn().mockResolvedValue(undefined),
    getOpenPanelSnapshots: vi.fn(() => []),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    refreshThreadList: vi.fn((fetchThreads: () => Promise<unknown>) => fetchThreads() as Promise<never[]>),
    cachedThreadList: vi.fn(() => null),
    ...overrides,
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

function threadFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "thread",
    sessionId: "session",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function turnFixture(items: Turn["items"], overrides: Partial<Turn> = {}): Turn {
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
