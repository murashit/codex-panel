import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../../src/app-server/connection/client";
import {
  ConnectionManager,
  type ConnectionManagerHandlers,
  StaleConnectionError,
} from "../../../src/app-server/connection/connection-manager";
import type { RpcOutboundMessage, ServerNotification } from "../../../src/app-server/connection/rpc-messages";
import type { AppServerTransport, AppServerTransportHandlers } from "../../../src/app-server/connection/transport";
import type { InitializeParams } from "../../../src/generated/app-server/InitializeParams";
import { commandApprovalRequestFixture } from "../../support/server-requests";

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

  emitLog(message: string): void {
    this.handlers.onLog(message);
  }
}

describe("ConnectionManager", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("allows a new connection after initialization fails", async () => {
    let transport!: SilentTransport;
    const manager = new ConnectionManager(
      "/bin/codex",
      "/vault",
      TEST_INITIALIZE_PARAMS,
      testClientFactory({ requestTimeoutMs: 5, onTransport: (next) => (transport = next) }),
    );

    await expect(manager.connect(silentConnectionHandlers())).rejects.toThrow("Codex did not finish connecting.");

    expect(transport.running).toBe(false);
    expect(manager.currentClient()).toBeNull();

    const retry = manager.connect(silentConnectionHandlers());
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/retry" } });
    await expect(retry).resolves.toMatchObject({ codexHome: "/tmp/retry" });
    expect(manager.currentClient()).toBeInstanceOf(AppServerClient);
  });

  it("shares an in-flight connection attempt", async () => {
    let transport!: SilentTransport;
    const manager = managerFixture((next) => (transport = next));

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

    const connecting = manager.connect({
      ...silentConnectionHandlers(),
      onNotification,
      onServerRequest: (_request, responder) => responder.respond({ decision: "decline" }),
    });
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex-a" } });
    await connecting;
    const notification = {
      method: "thread/name/updated",
      params: { threadId: "thread-a", threadName: "A" },
    } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>;

    transport.emitLine(notification);

    expect(onNotification).toHaveBeenCalledWith(notification);
    transport.emitLine(commandApprovalRequestFixture(46));
    expect(transport.sent.at(-1)).toEqual({ id: 46, result: { decision: "decline" } });
  });

  it("transitions to disconnected when a connected client exits", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = managerFixture((next) => (transport = next));
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
    const manager = managerFixture((next) => (transport = next));

    const connecting = manager.connect({ ...silentConnectionHandlers(), onExit });
    transport.emitExit();

    await expect(connecting).rejects.toThrow("Codex stopped before the connection was ready.");
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });

  it("marks initialization completed after disconnect as stale", async () => {
    let transport!: SilentTransport;
    const onExit = vi.fn();
    const manager = managerFixture((next) => (transport = next));

    const connecting = manager.connect({ ...silentConnectionHandlers(), onExit });
    manager.disconnect();
    expect(transport.running).toBe(false);
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });

    await expect(connecting).rejects.toBeInstanceOf(StaleConnectionError);
    expect(onExit).not.toHaveBeenCalled();
    expect(manager.currentClient()).toBeNull();
  });

  it("stops the transport when disconnecting an initialized client", async () => {
    let transport!: SilentTransport;
    const manager = managerFixture((next) => (transport = next));
    const connecting = manager.connect(silentConnectionHandlers());
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } });
    await connecting;
    expect(transport.running).toBe(true);

    manager.disconnect();

    expect(transport.running).toBe(false);
    expect(manager.currentClient()).toBeNull();
  });

  it("shares connection attempts and isolates retired transports across sampled lifecycle events", async () => {
    const events = fc.array(
      fc.record({
        kind: fc.constantFrom("connect", "ready", "fail", "exit", "disconnect", "notify", "request", "log"),
        slot: fc.nat(9),
        flush: fc.constantFrom("none", "microtask", "turn"),
      }),
      { maxLength: 60, size: "max" },
    );
    await expect(
      fc.assert(
        fc.asyncProperty(events, async (sequence) => {
          const transports: SilentTransport[] = [];
          const clients: AppServerClient[] = [];
          const outcomes: Promise<void>[] = [];
          const failures: unknown[] = [];
          const retiredInitializations = new Set<AppServerClient>();
          const handlers = {
            onNotification: vi.fn(),
            onServerRequest: vi.fn(),
            onLog: vi.fn(),
            onExit: vi.fn(),
          };
          const observers = new Map([
            ["notify", handlers.onNotification],
            ["request", handlers.onServerRequest],
            ["log", handlers.onLog],
          ]);
          const factory = testClientFactory({ requestTimeoutMs: 60_000, onTransport: (next) => transports.push(next) });
          const manager = new ConnectionManager("/bin/codex", "/vault", TEST_INITIALIZE_PARAMS, (...args) => {
            const client = factory(...args);
            clients.push(client);
            return client;
          });
          function connect(): void {
            const connecting = manager.connect(handlers);
            const attempt = clients.at(-1);
            const expectedHome = `/tmp/connection-${clients.length}`;
            outcomes.push(
              connecting.then(
                (response) => {
                  if (attempt && retiredInitializations.has(attempt)) failures.push("retired initialization succeeded");
                  if (response.codexHome !== expectedHome) failures.push(response);
                },
                (error: unknown) => {
                  if (!(error instanceof Error)) failures.push(error);
                  if (attempt && retiredInitializations.has(attempt) && !(error instanceof StaleConnectionError)) failures.push(error);
                },
              ),
            );
          }
          try {
            for (const event of sequence) {
              const transport = transports[event.slot % transports.length];
              const running = transport?.running ?? false;
              let expectedTransportCount = transports.length;
              const observer = observers.get(event.kind);
              const deliveriesBefore = observer?.mock.calls.length ?? 0;
              switch (event.kind) {
                case "connect": {
                  connect();
                  expectedTransportCount = transports.length;
                  connect();
                  break;
                }
                case "ready":
                  transport?.emitLine({ id: 1, result: { codexHome: `/tmp/connection-${transports.indexOf(transport) + 1}` } });
                  break;
                case "fail":
                  transport?.emitLine({ id: 1, error: { code: -32603, message: "Generated initialization failure" } });
                  break;
                case "exit":
                  transport?.emitExit();
                  break;
                case "disconnect": {
                  // The client can finish initialization while the manager still
                  // awaits its continuation. Retiring at that boundary must make
                  // pending connect callers stale, even though their RPC succeeded.
                  const initializing = clients.at(-1);
                  if (!manager.currentClient() && initializing?.isConnected()) retiredInitializations.add(initializing);
                  manager.disconnect();
                  break;
                }
                case "notify": {
                  transport?.emitLine({ method: "thread/name/updated", params: { threadId: "thread", threadName: "Generated" } });
                  break;
                }
                case "request": {
                  transport?.emitLine(commandApprovalRequestFixture(46));
                  break;
                }
                case "log": {
                  transport?.emitLog("generated log");
                  break;
                }
              }
              expect(transports).toHaveLength(expectedTransportCount);
              expect((observer?.mock.calls.length ?? 0) - deliveriesBefore).toBe(Number(observer !== undefined && running));
              // Allow shutdown both before client initialization continues and
              // between client initialization and the manager's continuation.
              if (event.flush === "microtask") await Promise.resolve();
              if (event.flush === "turn") await new Promise((resolve) => setImmediate(resolve));
              expect(transports.filter((candidate) => candidate.running).length).toBeLessThanOrEqual(event.kind === "disconnect" ? 0 : 1);
              expect([null, clients.at(-1)]).toContain(manager.currentClient());
              expect(failures).toEqual([]);
            }
            // Arbitrary failures and shutdowns must still permit a fresh attempt.
            manager.disconnect();
            await Promise.all(outcomes);
            const reconnecting = manager.connect(handlers);
            const transport = transports.at(-1);
            transport?.emitLine({ id: 1, result: { codexHome: "/tmp/recovered" } });
            await expect(reconnecting).resolves.toMatchObject({ codexHome: "/tmp/recovered" });
            const recovered = manager.currentClient();
            expect(recovered).toBe(clients.at(-1));
            const exits = handlers.onExit.mock.calls.length;
            for (const retired of transports.slice(0, -1)) retired.emitExit();
            expect(manager.currentClient()).toBe(recovered);
            expect(transport?.running).toBe(true);
            expect(handlers.onExit).toHaveBeenCalledTimes(exits);
          } finally {
            manager.disconnect();
            for (const client of clients) client.disconnect();
            await Promise.all(outcomes);
          }
          expect(failures).toEqual([]);
          expect(transports.every((transport) => !transport.running)).toBe(true);
        }),
        {
          numRuns: 200,
          examples: [
            [
              [
                { kind: "connect", slot: 0, flush: "none" },
                { kind: "ready", slot: 0, flush: "microtask" },
                { kind: "disconnect", slot: 0, flush: "turn" },
              ],
            ],
          ],
        },
      ),
    ).resolves.toBeUndefined();
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

function managerFixture(onTransport: (transport: SilentTransport) => void) {
  return new ConnectionManager("/bin/codex", "/vault", TEST_INITIALIZE_PARAMS, testClientFactory({ onTransport }));
}
