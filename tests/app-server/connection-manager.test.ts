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
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 5, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: () => undefined,
    });

    await expect(manager.connect()).rejects.toThrow("Codex app-server request timed out: initialize");

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
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: () => undefined,
    });

    const first = manager.connect();
    const second = manager.connect();
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
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit,
    });

    const connecting = manager.connect();
    transport.emitExit();

    await expect(connecting).rejects.toThrow("Codex app-server exited: unknown");
    expect(onExit).toHaveBeenCalledOnce();
    expect(manager.currentClient()).toBeNull();
  });

  it("uses the latest attached handlers for app-server events", async () => {
    let transport!: SilentTransport;
    const firstExit = vi.fn();
    const secondExit = vi.fn();
    const manager = new ConnectionManager(
      () => "/bin/codex",
      "/vault",
      (codexPath, cwd, handlers) =>
        new AppServerClient(codexPath, cwd, handlers, 500, (transportHandlers) => {
          transport = new SilentTransport(transportHandlers);
          return transport;
        }),
    );
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: firstExit,
    });
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: secondExit,
    });

    const connecting = manager.connect();
    transport.emitExit();

    await expect(connecting).rejects.toThrow("Codex app-server exited: unknown");
    expect(firstExit).not.toHaveBeenCalled();
    expect(secondExit).toHaveBeenCalledOnce();
  });

  it("fails clearly when app-server events arrive before handlers are attached", async () => {
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

    const connecting = manager.connect();

    expect(() => {
      transport.emitExit();
    }).toThrow("ConnectionManager handlers have not been attached.");
    await expect(connecting).rejects.toThrow("Codex app-server exited: unknown");
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
    manager.setHandlers({
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit,
    });

    const connecting = manager.connect();
    manager.disconnect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(connecting).rejects.toBeInstanceOf(StaleConnectionError);
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });
});
