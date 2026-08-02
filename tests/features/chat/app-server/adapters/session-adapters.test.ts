import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { AppServerRpcError } from "../../../../../src/app-server/connection/json-rpc-client";
import { createChatConnectedSessionAdapters } from "../../../../../src/features/chat/app-server/adapters/session-adapters";

describe("chat session adapters", () => {
  it("classifies an app-server steer error as a definitive rejection", async () => {
    const error = new AppServerRpcError("turn/steer", { code: -32000, message: "cannot steer this turn" });
    const adapters = adaptersWithSteerError(error);

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "failed", error });
  });

  it("classifies input preparation failure before dispatch as definitive", async () => {
    const request = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const adapters = adaptersWithClient(client);
    const input = Array.from({ length: 9 }, (_, index) => ({
      type: "additionalContext" as const,
      key: `source-${String(index)}`,
      kind: "untrusted" as const,
      value: "context",
    }));

    await expect(adapters.turn.steerTurn({ ...steerRequest(), input })).resolves.toMatchObject({
      kind: "failed",
      error: { message: "Too many additional context sources (9)." },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("classifies a synchronous request dispatch failure as definitive", async () => {
    const error = new Error("Codex app-server is not running.");
    const client = {
      request: vi.fn().mockImplementation(() => {
        throw error;
      }),
    } as unknown as AppServerClient;
    const adapters = adaptersWithClient(client);

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "failed", error });
  });

  it("classifies an asynchronous steer failure after dispatch as delivery unknown", async () => {
    const error = new Error("Codex app-server disconnected.");
    const adapters = adaptersWithSteerError(error);

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "delivery-unknown", error });
  });

  it("preserves an RPC steer failure after the current client changes", async () => {
    const error = new AppServerRpcError("turn/steer", { code: -32000, message: "old context rejected" });
    const replacementClient = {} as AppServerClient;
    let currentClient: AppServerClient | null;
    const client = {
      request: vi.fn().mockImplementation(async () => {
        currentClient = replacementClient;
        throw error;
      }),
    } as unknown as AppServerClient;
    currentClient = client;
    const adapters = createChatConnectedSessionAdapters({
      vaultPath: "/vault",
      currentClient: () => currentClient,
      connectedClient: async () => currentClient,
    });

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "failed", error });
  });
});

function adaptersWithSteerError(error: Error) {
  const client = {
    request: vi.fn().mockRejectedValue(error),
  } as unknown as AppServerClient;
  return adaptersWithClient(client);
}

function adaptersWithClient(client: AppServerClient) {
  return createChatConnectedSessionAdapters({
    vaultPath: "/vault",
    currentClient: () => client,
    connectedClient: async () => client,
  });
}

function steerRequest() {
  return {
    threadId: "thread",
    turnId: "turn",
    input: [{ type: "text" as const, text: "follow up" }],
    clientUserMessageId: "local-steer",
  };
}
