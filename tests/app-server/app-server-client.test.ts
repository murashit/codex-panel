import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerClientHandlers, AppServerServerRequestResponder } from "../../src/app-server/connection/client";
import { AppServerClient } from "../../src/app-server/connection/client";
import type { RpcOutboundMessage } from "../../src/app-server/connection/rpc-messages";
import type { AppServerTransport, AppServerTransportHandlers } from "../../src/app-server/connection/transport";
import type { InitializeParams } from "../../src/generated/app-server/InitializeParams";
import type { InitializeResponse } from "../../src/generated/app-server/InitializeResponse";
import type { ServerRequest } from "../../src/generated/app-server/ServerRequest";

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

class FakeTransport implements AppServerTransport {
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

  emitLine(message: unknown): void {
    this.handlers.onLine(JSON.stringify(message));
  }

  emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.running = false;
    this.handlers.onExit(code, signal);
  }

  emitError(error: Error): void {
    this.handlers.onError(error);
  }
}

async function connectedClient(): Promise<{ client: AppServerClient; transport: FakeTransport }> {
  let transport!: FakeTransport;
  const client = createTestClient({
    handlers: {
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: () => undefined,
    },
    transportFactory: (handlers) => {
      transport = new FakeTransport(handlers);
      return transport;
    },
  });
  const connecting = client.connect();
  transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
  await connecting;
  return { client, transport };
}

function createTestClient(options: {
  handlers: AppServerClientHandlers;
  requestTimeoutMs?: number;
  transportFactory: (handlers: AppServerTransportHandlers) => AppServerTransport;
  initializeParams?: InitializeParams;
}): AppServerClient {
  return new AppServerClient({
    codexPath: "/bin/codex",
    cwd: "/vault",
    handlers: options.handlers,
    initializeParams: options.initializeParams ?? TEST_INITIALIZE_PARAMS,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    transportFactory: options.transportFactory,
  });
}

function expectTransport(transport: FakeTransport | undefined): FakeTransport {
  if (!transport) throw new Error("Expected app-server transport.");
  return transport;
}

function latestSent(transport: FakeTransport): RpcOutboundMessage {
  const message = transport.sent.at(-1);
  if (!message) throw new Error("Expected an outbound app-server message.");
  return message;
}

async function expectRequest(
  transport: FakeTransport,
  request: Promise<unknown>,
  expected: Partial<RpcOutboundMessage>,
  result: unknown,
): Promise<void> {
  const sent = latestSent(transport);
  expect(sent).toMatchObject(expected);
  if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");
  transport.emitLine({ id: sent.id, result });
  await request;
}

function listModels(client: AppServerClient): Promise<unknown> {
  return client.request("model/list", { includeHidden: false, limit: 100 });
}

function readFile(client: AppServerClient, path: string, options: { timeoutMs?: number } = {}): Promise<unknown> {
  return client.request("fs/readFile", { path }, options);
}

describe("AppServerClient", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("routes responses, notifications, and server requests", async () => {
    let transport: FakeTransport;
    const getTransport = () => transport;
    const notifications: string[] = [];
    const serverRequests: ServerRequest[] = [];
    const serverRequestResponders: AppServerServerRequestResponder[] = [];
    const client = createTestClient({
      initializeParams: {
        clientInfo: {
          name: "custom_client",
          title: "Custom Client",
          version: "1.2.3",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
      handlers: {
        onNotification: (notification) => notifications.push(notification.method),
        onServerRequest: (request, responder) => {
          serverRequests.push(request);
          serverRequestResponders.push(responder);
        },
        onLog: () => undefined,
        onExit: () => undefined,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });

    const connecting = client.connect();
    expect(getTransport().sent[0]).toMatchObject({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "custom_client",
          title: "Custom Client",
          version: "1.2.3",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    });
    getTransport().emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await expect(connecting).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    expect(getTransport().sent[1]).toEqual({ method: "initialized" });

    getTransport().emitLine({ method: "warning", params: { message: "careful" } });
    expect(notifications).toEqual(["warning"]);

    getTransport().emitLine({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "npm run build",
        cwd: "/vault",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
      },
    });
    expect(serverRequests[0]?.method).toBe("item/commandExecution/requestApproval");
    serverRequestResponders[0]?.reject(-32601, "Request not handled.");
    expect(latestSent(getTransport())).toEqual({ id: 99, error: { code: -32601, message: "Request not handled." } });
  });

  it("logs malformed JSON-RPC envelopes without throwing from the transport callback", async () => {
    const logs: string[] = [];
    const notifications = vi.fn();
    const serverRequests = vi.fn();
    let transport!: FakeTransport;
    const client = createTestClient({
      handlers: {
        onNotification: notifications,
        onServerRequest: serverRequests,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    for (const message of [null, 42, "text", [], {}, { method: "warning" }, { id: 4 }, { id: 5, method: "request", params: null }]) {
      expect(() => transport.emitLine(message)).not.toThrow();
    }

    expect(notifications).not.toHaveBeenCalled();
    expect(serverRequests).not.toHaveBeenCalled();
    expect(logs).toHaveLength(8);
    expect(logs.every((message) => message.startsWith("Invalid app-server JSON-RPC message:"))).toBe(true);
  });

  it("contains inbound handler failures at the JSON-RPC boundary", async () => {
    const logs: string[] = [];
    let transport!: FakeTransport;
    const client = createTestClient({
      handlers: {
        onNotification: () => {
          throw new Error("notification failed");
        },
        onServerRequest: () => undefined,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    expect(() => transport.emitLine({ method: "warning", params: { message: "careful" } })).not.toThrow();
    expect(logs).toEqual(["App-server notification handler failed: notification failed"]);
  });

  it("sends typed client requests", async () => {
    const { client, transport } = await connectedClient();

    const request = client.request("thread/inject_items", {
      threadId: "thread-1",
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Ship this" }],
        },
      ],
    });

    await expectRequest(
      transport,
      request,
      {
        method: "thread/inject_items",
        params: {
          threadId: "thread-1",
          items: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Ship this" }],
            },
          ],
        },
      },
      {},
    );
  });

  it("exposes initialized state through a single connection lifecycle", async () => {
    const { client, transport } = await connectedClient();

    expect(client.isConnected()).toBe(true);
    expect(client.initializeResponse).toMatchObject({ codexHome: "/tmp/codex" });

    transport.emitExit(0);

    expect(client.isConnected()).toBe(false);
    expect(() => client.initializeResponse).toThrow("Codex app-server has not initialized.");
  });

  it("clears initialized state and rejects pending requests on disconnect", async () => {
    const { client } = await connectedClient();
    const listing = listModels(client);

    client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(() => client.initializeResponse).toThrow("Codex app-server has not initialized.");
    await expect(listing).rejects.toThrow("Codex app-server disconnected.");
  });

  it("does not notify external exit handlers for intentional disconnect exits", async () => {
    let transport!: FakeTransport;
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    client.disconnect();
    transport.emitExit(0);

    expect(onExit).not.toHaveBeenCalled();
  });

  it("fails active transports on transport error without waiting for exit", async () => {
    let transport!: FakeTransport;
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;
    const listing = listModels(client);

    transport.emitError(new Error("transport failed"));

    expect(client.isConnected()).toBe(false);
    expect(transport.isRunning()).toBe(false);
    await expect(listing).rejects.toThrow("transport failed");
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith(null, null);

    transport.emitExit(1);

    expect(onExit).toHaveBeenCalledOnce();
  });

  it("cleans up the active transport when initialize fails", async () => {
    const transports: FakeTransport[] = [];
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        const transport = new FakeTransport(handlers);
        transports.push(transport);
        return transport;
      },
    });

    const connecting = client.connect();
    const firstTransport = expectTransport(transports[0]);
    const initialize = latestSent(firstTransport);
    if (!("id" in initialize) || typeof initialize.id !== "number") throw new Error("Expected initialize request.");

    const rejection = expect(connecting).rejects.toThrow("initialize failed");
    firstTransport.emitLine({ id: initialize.id, error: { code: -32000, message: "initialize failed" } });

    await rejection;
    expect(client.isConnected()).toBe(false);
    expect(firstTransport.isRunning()).toBe(false);

    firstTransport.emitExit(1);
    expect(onExit).not.toHaveBeenCalled();

    const reconnecting = client.connect();
    const secondTransport = expectTransport(transports[1]);
    const secondInitialize = latestSent(secondTransport);
    if (!("id" in secondInitialize) || typeof secondInitialize.id !== "number") throw new Error("Expected initialize request.");
    secondTransport.emitLine({ id: secondInitialize.id, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });

    await expect(reconnecting).resolves.toMatchObject({ codexHome: "/tmp/codex" });
  });

  it("cleans up the active transport when initialize times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    let transport!: FakeTransport;
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });

    const connecting = client.connect();
    const rejection = expect(connecting).rejects.toThrow("Codex app-server request timed out: initialize");
    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(client.isConnected()).toBe(false);
    expect(transport.isRunning()).toBe(false);

    transport.emitExit(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("rejects connect without notifying external exit handlers when transport exits during initialize", async () => {
    let transport!: FakeTransport;
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });

    const connecting = client.connect();
    const rejection = expect(connecting).rejects.toThrow("Codex app-server exited: 1");
    transport.emitExit(1);

    await rejection;
    expect(client.isConnected()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("ignores stale transport events after reconnecting", async () => {
    const transports: FakeTransport[] = [];
    const onExit = vi.fn();
    const onNotification = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        const transport = new FakeTransport(handlers);
        transports.push(transport);
        return transport;
      },
    });

    const firstConnect = client.connect();
    transports[0]?.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await firstConnect;
    client.disconnect();
    const secondConnect = client.connect();
    const secondInitialize = latestSent(expectTransport(transports[1]));
    if (!("id" in secondInitialize) || typeof secondInitialize.id !== "number") throw new Error("Expected initialize request.");
    transports[1]?.emitLine({ id: secondInitialize.id, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await secondConnect;

    transports[0]?.emitLine({ method: "warning", params: { message: "stale" } });
    transports[0]?.emitError(new Error("stale failure"));
    transports[0]?.emitExit(1);

    expect(client.isConnected()).toBe(true);
    expect(onNotification).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("ignores synchronous transport callbacks before the transport becomes active", async () => {
    let transport!: FakeTransport;
    const onExit = vi.fn();
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit,
      },
      transportFactory: (handlers) => {
        handlers.onLine(JSON.stringify({ method: "warning", params: { message: "early" } }));
        handlers.onError(new Error("early failure"));
        handlers.onExit(1, null);
        transport = new FakeTransport(handlers);
        return transport;
      },
    });

    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    expect(client.isConnected()).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it("suppresses late responses after per-request timeouts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    const logs: string[] = [];
    let transport!: FakeTransport;
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    const reading = readFile(client, "/tmp/slow.jsonl", { timeoutMs: 10 });
    const rejection = expect(reading).rejects.toThrow("Codex app-server request timed out: fs/readFile");
    const sent = latestSent(transport);
    if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");

    await vi.advanceTimersByTimeAsync(10);
    await rejection;

    transport.emitLine({ id: sent.id, result: { dataBase64: btoa("late") } });
    expect(logs).toEqual([]);
  });

  it("bounds timed-out response suppression when responses never arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    const logs: string[] = [];
    let transport!: FakeTransport;
    const client = createTestClient({
      handlers: {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      transportFactory: (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    });
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    const timedOutRequests: { id: number; rejection: Promise<void> }[] = [];
    for (let index = 0; index < 257; index += 1) {
      const promise = readFile(client, `/tmp/slow-${String(index)}.jsonl`, { timeoutMs: 10 });
      const rejection = expect(promise).rejects.toThrow("Codex app-server request timed out");
      const sent = latestSent(transport);
      if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");
      timedOutRequests.push({ id: sent.id, rejection });
    }

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(timedOutRequests.map(({ rejection }) => rejection));

    const firstTimedOutRequest = timedOutRequests[0];
    const lastTimedOutRequest = timedOutRequests.at(-1);
    if (!firstTimedOutRequest || !lastTimedOutRequest) throw new Error("Expected timed-out requests.");

    transport.emitLine({ id: firstTimedOutRequest.id, result: { dataBase64: btoa("evicted") } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Orphan app-server response");

    transport.emitLine({ id: lastTimedOutRequest.id, result: { dataBase64: btoa("suppressed") } });
    expect(logs).toHaveLength(1);
  });

  it("preserves app-server RPC error codes", async () => {
    const { client, transport } = await connectedClient();

    const listing = listModels(client);
    transport.emitLine({ id: 2, error: { code: -32601, message: "Method not found" } });

    await expect(listing).rejects.toMatchObject({
      name: "AppServerRpcError",
      code: -32601,
      method: "model/list",
      message: "Method not found",
    });
  });
});
