// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
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

installObsidianDomShims();

describe("CodexThreadsView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    connectionMock.reset();
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
    view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row")?.click();

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
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')?.click();

    await vi.waitFor(() => {
      expect(setThreadName).toHaveBeenCalledWith("thread", "Renamed thread");
      expect(host.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed thread");
    });
  });
});

function clientFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listThreads: vi.fn().mockResolvedValue({ data: [] }),
    archiveThread: vi.fn().mockResolvedValue({}),
    setThreadName: vi.fn().mockResolvedValue({}),
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
    refreshOpenThreadLists: vi.fn(),
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
