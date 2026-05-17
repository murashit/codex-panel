import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../src/app-server/client";
import { ConnectionManager, StaleConnectionError } from "../../src/app-server/connection-manager";
import type { AppServerTransport, AppServerTransportHandlers } from "../../src/app-server/transport";
import type { RpcOutboundMessage } from "../../src/app-server/types";

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
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit: () => undefined,
      },
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 5, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );

    await expect(manager.connect()).rejects.toThrow("Codex app-server request timed out: initialize");

    expect(transport.running).toBe(false);
    expect(manager.currentClient()).toBeNull();
  });

  it("marks initialization completed after disconnect as stale", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = new ConnectionManager(
      () => "/bin/codex",
      "/vault",
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 500, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );

    const connecting = manager.connect();
    manager.disconnect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(connecting).rejects.toBeInstanceOf(StaleConnectionError);
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });
});
