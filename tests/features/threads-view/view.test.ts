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

  it("reuses an idle empty panel before opening a new panel", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost({
      openThreadInIdleEmptyView: vi.fn().mockResolvedValue(true),
      openThreadInNewView: vi.fn(),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row")?.click();

    await vi.waitFor(() => {
      expect(host.openThreadInIdleEmptyView).toHaveBeenCalledWith("thread");
    });
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
  });

  it("opens a new panel when no idle empty panel can be reused", async () => {
    connectionMock.state.client = clientFixture({
      listThreads: vi.fn().mockResolvedValue({ data: [threadFixture({ id: "thread", preview: "Thread preview" })] }),
    });
    const host = threadsHost({
      openThreadInIdleEmptyView: vi.fn().mockResolvedValue(false),
      openThreadInNewView: vi.fn(),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row")?.click();

    await vi.waitFor(() => {
      expect(host.openThreadInIdleEmptyView).toHaveBeenCalledWith("thread");
      expect(host.openThreadInNewView).toHaveBeenCalledWith("thread");
    });
  });
});

function clientFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listThreads: vi.fn().mockResolvedValue({ data: [] }),
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
    openThreadInNewView: vi.fn(),
    openThreadInIdleEmptyView: vi.fn().mockResolvedValue(false),
    getOpenPanelSnapshots: vi.fn(() => []),
    focusOpenPanel: vi.fn(),
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
