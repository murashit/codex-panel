import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../src/app-server/connection/client";
import {
  ConnectionManager,
  type ConnectionManagerHandlers,
  StaleConnectionError,
} from "../../src/app-server/connection/connection-manager";
import type { AppServerTransport, AppServerTransportHandlers } from "../../src/app-server/connection/transport";
import type { RpcOutboundMessage } from "../../src/app-server/connection/rpc-messages";

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

  it("reports app-server exit during initialization", async () => {
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
    expect(onExit).toHaveBeenCalledOnce();
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
