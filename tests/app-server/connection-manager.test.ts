import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../src/app-server/connection/client";
import {
  ConnectionManager,
  type ConnectionManagerHandlers,
  StaleConnectionError,
} from "../../src/app-server/connection/connection-manager";
import type { RpcOutboundMessage } from "../../src/app-server/connection/rpc-messages";
import type { AppServerTransport, AppServerTransportHandlers } from "../../src/app-server/connection/transport";

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
      () => "/bin/codex",
      "/vault",
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 5, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );

    await expect(manager.connect(silentConnectionHandlers())).rejects.toThrow("Codex app-server request timed out: initialize");

    expect(transport.running).toBe(false);
    expect(manager.currentClient()).toBeNull();
  });

  it("shares an in-flight connection attempt", async () => {
    let transport!: SilentTransport;
    const manager = new ConnectionManager(
      () => "/bin/codex",
      "/vault",
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 500, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );

    const first = manager.connect(silentConnectionHandlers());
    const second = manager.connect(silentConnectionHandlers());
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(first).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    await expect(second).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    expect(transport.sent).toHaveLength(2);
    expect(manager.currentClient()).toBeInstanceOf(AppServerClient);
  });

  it("does not reuse a connected client after the command context changes", async () => {
    let codexPath = "/bin/codex-a";
    const transports: SilentTransport[] = [];
    const manager = new ConnectionManager(
      () => codexPath,
      "/vault",
      (clientCodexPath, cwd, handlers) =>
        new AppServerClient(clientCodexPath, cwd, handlers, 500, (transportHandlers) => {
          const transport = new SilentTransport(transportHandlers);
          transports.push(transport);
          return transport;
        }),
    );

    const first = manager.connect(silentConnectionHandlers());
    transports[0]?.emitLine({ id: 1, result: { codexHome: "/tmp/codex-a" } });
    await expect(first).resolves.toMatchObject({ codexHome: "/tmp/codex-a" });
    expect(manager.currentClient()).toBeInstanceOf(AppServerClient);
    expect(manager.currentConnectionContext()).toEqual({ codexPath: "/bin/codex-a", cwd: "/vault" });

    codexPath = "/bin/codex-b";

    expect(manager.currentClient()).toBeNull();
    expect(manager.currentConnectionContext()).toBeNull();
    const second = manager.connect(silentConnectionHandlers());
    transports[1]?.emitLine({ id: 1, result: { codexHome: "/tmp/codex-b" } });

    await expect(second).resolves.toMatchObject({ codexHome: "/tmp/codex-b" });
    expect(transports).toHaveLength(2);
    expect(transports[0]?.running).toBe(false);
    expect(manager.currentClient()).toBeInstanceOf(AppServerClient);
    expect(manager.currentConnectionContext()).toEqual({ codexPath: "/bin/codex-b", cwd: "/vault" });
  });

  it("rejects app-server exit during initialization without reporting a connected-client exit", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = new ConnectionManager(
      () => "/bin/codex",
      "/vault",
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 500, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
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
      () => "/bin/codex",
      "/vault",
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 500, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
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
