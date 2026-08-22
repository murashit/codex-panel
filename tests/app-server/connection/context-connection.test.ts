import { describe, expect, it, vi } from "vitest";

import type { AppServerClient, AppServerServerRequestResponder } from "../../../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../../../src/app-server/connection/connection-manager";
import {
  AppServerContextConnection,
  type AppServerContextConnectionLeaseHandlers,
} from "../../../src/app-server/connection/context-connection";
import type { ServerNotification, ServerRequest } from "../../../src/app-server/connection/rpc-messages";
import type { ServerInitialization } from "../../../src/domain/server/initialization";
import type { InitializeParams } from "../../../src/generated/app-server/InitializeParams";

const INITIALIZE_PARAMS = {
  clientInfo: { name: "test", title: "Test", version: "0" },
  capabilities: { experimentalApi: true, requestAttestation: false },
} satisfies InitializeParams;

const INITIALIZATION: ServerInitialization = {
  codexHome: "/tmp/codex",
  platformFamily: "unix",
  platformOs: "macos",
  userAgent: "test",
};

describe("AppServerContextConnection", () => {
  it("shares one connected client across panel leases and context operations", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const first = connection.createLease();
    const second = connection.createLease();

    await first.connect(leaseHandlers());
    await second.connect(leaseHandlers());
    const result = await connection.withClient(async (client) => client);

    expect(first.currentClient()).toBe(manager.client);
    expect(second.currentClient()).toBe(manager.client);
    expect(result).toBe(manager.client);
    expect(manager.connect).toHaveBeenCalledTimes(3);
    expect(manager.handlers).toBeDefined();
  });

  it("fans unconsumed notifications out to connected panel leases", async () => {
    const manager = managerFixture();
    const onContextNotification = vi.fn(() => false);
    const connection = contextConnection(manager, onContextNotification);
    const first = leaseHandlers();
    const second = leaseHandlers();
    await connection.createLease().connect(first);
    await connection.createLease().connect(second);
    const notification = {
      method: "thread/name/updated",
      params: { threadId: "thread", threadName: "Renamed" },
    } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>;

    manager.handlers?.onNotification(notification);

    expect(first.onNotification).toHaveBeenCalledWith(notification);
    expect(second.onNotification).toHaveBeenCalledWith(notification);
    expect(onContextNotification).toHaveBeenCalledOnce();
    expect(onContextNotification).toHaveBeenCalledWith(notification);
  });

  it("does not fan context-owned lifecycle notifications out to panel leases", async () => {
    const manager = managerFixture();
    const onContextNotification = vi.fn(() => true);
    const connection = contextConnection(manager, onContextNotification);
    const panel = leaseHandlers();
    await connection.createLease().connect(panel);
    const notification = {
      method: "thread/archived",
      params: { threadId: "thread" },
    } satisfies Extract<ServerNotification, { method: "thread/archived" }>;

    manager.handlers?.onNotification(notification);

    expect(onContextNotification).toHaveBeenCalledWith(notification);
    expect(panel.onNotification).not.toHaveBeenCalled();
  });

  it("delivers inbound messages to a lease while its shared connect is settling", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const handlers = leaseHandlers({ onServerRequest: vi.fn(() => true) });

    const connecting = connection.createLease().connect(handlers);
    const notification = {
      method: "thread/archived",
      params: { threadId: "descendant" },
    } satisfies Extract<ServerNotification, { method: "thread/archived" }>;
    const request = serverRequest();
    const responder = responderFixture();
    manager.handlers?.onNotification(notification);
    manager.handlers?.onServerRequest(request, responder);

    expect(handlers.onNotification).toHaveBeenCalledWith(notification);
    expect(handlers.onServerRequest).toHaveBeenCalledWith(request, responder);
    expect(responder.reject).not.toHaveBeenCalled();
    await connecting;
  });

  it("gives each server request to only the first panel that claims its scope", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const inactive = leaseHandlers({ onServerRequest: vi.fn(() => false) });
    const owner = leaseHandlers({ onServerRequest: vi.fn(() => true) });
    const other = leaseHandlers({ onServerRequest: vi.fn(() => true) });
    await connection.createLease().connect(inactive);
    await connection.createLease().connect(owner);
    await connection.createLease().connect(other);
    const request = serverRequest();
    const responder = responderFixture();

    manager.handlers?.onServerRequest(request, responder);

    expect(inactive.onServerRequest).toHaveBeenCalledWith(request, responder);
    expect(owner.onServerRequest).toHaveBeenCalledWith(request, responder);
    expect(other.onServerRequest).not.toHaveBeenCalled();
    expect(responder.reject).not.toHaveBeenCalled();
  });

  it("expires every lease before invoking the first process-exit callback", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const first = connection.createLease();
    const second = connection.createLease();
    const firstHandlers = leaseHandlers({
      onExit: vi.fn(() => {
        expect(first.currentClient()).toBeNull();
        expect(first.isConnected()).toBe(false);
        expect(second.currentClient()).toBeNull();
        expect(second.isConnected()).toBe(false);
      }),
    });
    const secondHandlers = leaseHandlers();
    await first.connect(firstHandlers);
    await second.connect(secondHandlers);

    manager.handlers?.onExit();

    expect(firstHandlers.onExit).toHaveBeenCalledOnce();
    expect(secondHandlers.onExit).toHaveBeenCalledOnce();
  });

  it("does not reactivate exited panel leases when a context operation reconnects the process", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const firstHandlers = leaseHandlers();
    const secondHandlers = leaseHandlers();
    const first = connection.createLease();
    const second = connection.createLease();
    await first.connect(firstHandlers);
    await second.connect(secondHandlers);
    manager.exit();

    await connection.withClient(async (client) => client);
    const responder = responderFixture();
    manager.handlers?.onNotification(threadNameNotification());
    manager.handlers?.onServerRequest(serverRequest(), responder);

    expect(first.currentClient()).toBeNull();
    expect(second.currentClient()).toBeNull();
    expect(firstHandlers.onNotification).not.toHaveBeenCalled();
    expect(secondHandlers.onNotification).not.toHaveBeenCalled();
    expect(firstHandlers.onServerRequest).not.toHaveBeenCalled();
    expect(secondHandlers.onServerRequest).not.toHaveBeenCalled();
    expect(responder.reject).toHaveBeenCalledOnce();
  });

  it("reattaches only the panel lease that explicitly reconnects after process exit", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const firstHandlers = leaseHandlers();
    const secondHandlers = leaseHandlers();
    const first = connection.createLease();
    const second = connection.createLease();
    await first.connect(firstHandlers);
    await second.connect(secondHandlers);
    manager.exit();
    const reconnectedHandlers = leaseHandlers({ onServerRequest: vi.fn(() => true) });

    await first.connect(reconnectedHandlers);
    const responder = responderFixture();
    manager.handlers?.onNotification(threadNameNotification());
    manager.handlers?.onServerRequest(serverRequest(), responder);

    expect(first.currentClient()).toBe(manager.client);
    expect(second.currentClient()).toBeNull();
    expect(reconnectedHandlers.onNotification).toHaveBeenCalledOnce();
    expect(reconnectedHandlers.onServerRequest).toHaveBeenCalledOnce();
    expect(firstHandlers.onNotification).not.toHaveBeenCalled();
    expect(secondHandlers.onNotification).not.toHaveBeenCalled();
    expect(secondHandlers.onServerRequest).not.toHaveBeenCalled();
    expect(responder.reject).not.toHaveBeenCalled();
  });

  it.each([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "currentTime/read",
    "future/request",
  ] as const)("rejects unclaimed request %s once", async (method) => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    await connection.createLease().connect(leaseHandlers({ onServerRequest: vi.fn(() => false) }));
    const responder = responderFixture();

    manager.handlers?.onServerRequest(serverRequestWithMethod(method), responder);

    expect(responder.reject).toHaveBeenCalledOnce();
    expect(responder.reject).toHaveBeenCalledWith(-32601, expect.stringContaining("No Codex Panel view"));
  });

  it("releases one panel lease without disconnecting the shared process", async () => {
    const manager = managerFixture();
    const connection = contextConnection(manager);
    const firstHandlers = leaseHandlers();
    const secondHandlers = leaseHandlers();
    const first = connection.createLease();
    const second = connection.createLease();
    await first.connect(firstHandlers);
    await second.connect(secondHandlers);

    first.disconnect();
    manager.handlers?.onNotification({
      method: "thread/archived",
      params: { threadId: "thread" },
    } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

    expect(firstHandlers.onNotification).not.toHaveBeenCalled();
    expect(secondHandlers.onNotification).toHaveBeenCalledOnce();
    expect(manager.disconnect).not.toHaveBeenCalled();

    connection.dispose();
    expect(manager.disconnect).toHaveBeenCalledOnce();
  });
});

function contextConnection(manager: ReturnType<typeof managerFixture>, onNotification = vi.fn(() => false)): AppServerContextConnection {
  return new AppServerContextConnection("codex", "/vault", INITIALIZE_PARAMS, { onNotification }, manager as never);
}

function managerFixture() {
  const client = { request: vi.fn(), disconnect: vi.fn() } as unknown as AppServerClient;
  let handlers: ConnectionManagerHandlers | null = null;
  let connected = false;
  return {
    client,
    get handlers(): ConnectionManagerHandlers | null {
      return handlers;
    },
    connect: vi.fn(async (nextHandlers: ConnectionManagerHandlers) => {
      handlers ??= nextHandlers;
      connected = true;
      return INITIALIZATION;
    }),
    currentClient: vi.fn(() => (connected ? client : null)),
    exit: () => {
      connected = false;
      handlers?.onExit();
    },
    disconnect: vi.fn(() => {
      connected = false;
    }),
  };
}

function leaseHandlers(
  overrides: Partial<AppServerContextConnectionLeaseHandlers> = {},
): AppServerContextConnectionLeaseHandlers & Record<"onNotification" | "onServerRequest" | "onLog" | "onExit", ReturnType<typeof vi.fn>> {
  return {
    onNotification: vi.fn(),
    onServerRequest: vi.fn(() => false),
    onLog: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  } as never;
}

function responderFixture(): AppServerServerRequestResponder & {
  respond: ReturnType<typeof vi.fn<(result: unknown) => void>>;
  reject: ReturnType<typeof vi.fn<(code: number, message: string) => void>>;
} {
  return { respond: vi.fn<(result: unknown) => void>(), reject: vi.fn<(code: number, message: string) => void>() };
}

function serverRequest(): ServerRequest {
  return {
    method: "currentTime/read",
    id: 1,
    params: { threadId: "thread" },
  } satisfies Extract<ServerRequest, { method: "currentTime/read" }>;
}

function serverRequestWithMethod(method: string): ServerRequest {
  return { method, id: 1, params: {} } as unknown as ServerRequest;
}

function threadNameNotification(): Extract<ServerNotification, { method: "thread/name/updated" }> {
  return { method: "thread/name/updated", params: { threadId: "thread", threadName: "Renamed" } };
}
