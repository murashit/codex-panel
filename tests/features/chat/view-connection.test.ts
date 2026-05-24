// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { notices } from "../../mocks/obsidian";
import { installObsidianDomShims } from "./ui/dom-test-helpers";

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connectCalls: 0,
    connected: false,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connectCalls = 0;
      state.connected = false;
    },
  };
});

vi.mock("../../../src/app-server/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    connect(): Promise<unknown> {
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

    reconnect(): void {
      this.disconnect();
    }

    disconnect(): void {
      connectionMock.state.connected = false;
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

installObsidianDomShims();

describe("CodexChatView connection lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    connectionMock.state.client = client;
    const view = await chatView();

    await Promise.all([view.connect(), view.connect()]);

    expect(connectionMock.state.connectCalls).toBe(1);
    expect(client.readEffectiveConfig).toHaveBeenCalledTimes(1);
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.listSkills).toHaveBeenCalledTimes(1);
    expect(client.readAccountRateLimits).toHaveBeenCalledTimes(1);
    expect(client.listThreads).toHaveBeenCalledTimes(1);
  });

  it("ignores stale connection work after the view closes", async () => {
    let resolveConfig!: (value: unknown) => void;
    const client = connectedClient({
      readEffectiveConfig: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveConfig = resolve;
          }),
      ),
    });
    connectionMock.state.client = client;
    const view = await chatView();

    const connecting = view.connect();
    await Promise.resolve();
    await view.onClose();
    resolveConfig({});
    await connecting;

    expect(notices).toEqual([]);
    expect(client.listThreads).not.toHaveBeenCalled();
  });
});

function connectedClient(overrides: Partial<ReturnType<typeof baseClient>> = {}): ReturnType<typeof baseClient> {
  return {
    ...baseClient(),
    ...overrides,
  };
}

function baseClient() {
  return {
    readEffectiveConfig: vi.fn().mockResolvedValue({}),
    listModels: vi.fn().mockResolvedValue({ data: [] }),
    listSkills: vi.fn().mockResolvedValue({ data: [] }),
    readAccountRateLimits: vi.fn().mockResolvedValue({ rateLimits: null }),
    listThreads: vi.fn().mockResolvedValue({ data: [] }),
  };
}

async function chatView() {
  const { CodexChatView } = await import("../../../src/features/chat/view");
  const containerEl = document.createElement("div");
  containerEl.createDiv();
  containerEl.createDiv();
  return new CodexChatView(
    {
      app: {
        vault: {
          on: vi.fn(() => ({})),
        },
      },
      containerEl,
    } as never,
    {
      settings: {
        ...DEFAULT_SETTINGS,
        codexPath: "codex",
        sendShortcut: "enter",
      },
      vaultPath: "/vault",
      openThreadInNewView: vi.fn(),
      openTurnDiff: vi.fn(),
      refreshOpenThreadLists: vi.fn(),
    },
  );
}
