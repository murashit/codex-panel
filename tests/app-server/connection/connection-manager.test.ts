import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../../src/app-server/connection/client";
import {
  ConnectionManager,
  type ConnectionManagerHandlers,
  StaleConnectionError,
} from "../../../src/app-server/connection/connection-manager";
import type { RpcOutboundMessage, ServerNotification } from "../../../src/app-server/connection/rpc-messages";
import type { AppServerTransport, AppServerTransportHandlers } from "../../../src/app-server/connection/transport";
import type { InitializeParams } from "../../../src/generated/app-server/InitializeParams";

const TEST_INITIALIZE_PARAMS: InitializeParams = {
  clientInfo: {
    name: "test_client",
    title: "Test Client",
    version: "0.0.0",
  },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
  },
};

class SilentTransport implements AppServerTransport {
  readonly sent: RpcOutboundMessage[] = [];
  running = false;

  constructor(private readonly handlers: AppServerTransportHandlers) {}

  start(): void {
    this.running = true;
  }

  send(message: RpcOutboundMessage): void {
    this.sent.push(message);
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  emitExit(): void {
    this.running = false;
    this.handlers.onExit(null, null);
  }

  emitLine(message: unknown): void {
    this.handlers.onLine(JSON.stringify(message));
  }
}

describe("ConnectionManager", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
  });

  it("disconnects clients whose initialization fails", async () => {
    let transport!: SilentTransport;
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ requestTimeoutMs: 5, onTransport: (next) => (transport = next) }),
    );

    await expect(manager.connect(silentConnectionHandlers())).rejects.toThrow("Codex app-server request timed out: initialize");

    expect(transport.running).toBe(false);
    expect(manager.currentClient()).toBeNull();
  });

  it("shares an in-flight connection attempt", async () => {
    let transport!: SilentTransport;
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ onTransport: (next) => (transport = next) }),
    );

    const first = manager.connect(silentConnectionHandlers());
    const second = manager.connect(silentConnectionHandlers());
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(first).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    await expect(second).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    expect(transport.sent).toHaveLength(2);
    expect(manager.currentClient()).toBeInstanceOf(AppServerClient);
  });

  it("delivers inbound events from the active connection", async () => {
    let transport!: SilentTransport;
    const onNotification = vi.fn();
    const manager = new ConnectionManager(
      "/bin/codex-a",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ onTransport: (next) => (transport = next) }),
    );

    const connecting = manager.connect({ ...silentConnectionHandlers(), onNotification });
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex-a" } });
    await connecting;
    const notification = {
      method: "thread/name/updated",
      params: { threadId: "thread-a", threadName: "A" },
    } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>;

    transport.emitLine(notification);

    expect(onNotification).toHaveBeenCalledWith(notification);
  });

  it("transitions to disconnected when a connected client exits", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ onTransport: (next) => (transport = next) }),
    );
    const connecting = manager.connect({ ...silentConnectionHandlers(), onExit });
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });
    await connecting;

    transport.emitExit();

    expect(manager.currentClient()).toBeNull();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("rejects app-server exit during initialization without reporting a connected-client exit", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ onTransport: (next) => (transport = next) }),
    );

    const connecting = manager.connect({ ...silentConnectionHandlers(), onExit });
    transport.emitExit();

    await expect(connecting).rejects.toThrow("Codex app-server exited: unknown");
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });

  it("marks initialization completed after disconnect as stale", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ onTransport: (next) => (transport = next) }),
    );

    const connecting = manager.connect({ ...silentConnectionHandlers(), onExit });
    manager.disconnect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(connecting).rejects.toBeInstanceOf(StaleConnectionError);
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });
});

function silentConnectionHandlers(): ConnectionManagerHandlers {
  return {
    onNotification: () => undefined,
    onServerRequest: () => undefined,
    onLog: () => undefined,
    onExit: () => undefined,
  };
}

type AppServerClientFactory = NonNullable<ConstructorParameters<typeof ConnectionManager>[3]>;

function testClientFactory(options: {
  requestTimeoutMs?: number;
  onTransport: (transport: SilentTransport) => void;
}): AppServerClientFactory {
  return (codexPath, cwd, handlers) =>
    new AppServerClient({
      codexPath,
      cwd,
      handlers,
      initializeParams: TEST_INITIALIZE_PARAMS,
      requestTimeoutMs: options.requestTimeoutMs ?? 500,
      transportFactory: (transportHandlers) => {
        const transport = new SilentTransport(transportHandlers);
        options.onTransport(transport);
        return transport;
      },
    });
}
