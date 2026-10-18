import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { AppServerRpcError } from "../../../../../src/app-server/connection/json-rpc-client";
import { createChatSessionAdapters } from "../../../../../src/features/chat/app-server/adapters/session-adapters";
import { deferred } from "../../../../support/async";

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

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "delivery-unknown" });
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
    const adapters = createChatSessionAdapters({
      vaultPath: "/vault",
      recordThreadSubscription: vi.fn(),
      currentClient: () => currentClient,
    });

    await expect(adapters.turn.steerTurn(steerRequest())).resolves.toEqual({ kind: "failed", error });
  });
  it.each(["thread/inject_items", "turn/start"] as const)("keeps cleanup on its original client after %s is superseded", async (stage) => {
    const pending = deferred<unknown>();
    const dispatched = deferred<void>();
    const request = vi.fn((method: string) => {
      if (method === stage) {
        dispatched.resolve();
        return pending.promise;
      }
      if (method === "config/read") return Promise.resolve({ config: {} });
      if (method === "thread/fork")
        return Promise.resolve({ thread: { id: "side", preview: "", createdAt: 1, updatedAt: 1 }, model: "model" });
      return Promise.resolve({});
    });
    const original = { request } as unknown as AppServerClient;
    const replacement = { request: vi.fn() } as unknown as AppServerClient;
    let current = original;
    const adapters = createChatSessionAdapters({ vaultPath: "/vault", currentClient: () => current, recordThreadSubscription: vi.fn() });
    const forking = adapters.threadEphemeral.forkEphemeralThread("parent", {}, () => true);
    let cleanup: Promise<void> | undefined;
    let result: Promise<unknown>;
    if (stage === "thread/inject_items") result = expect(forking).resolves.toBeNull();
    else {
      await forking;
      result = expect(adapters.turn.startTurn({ threadId: "side", input: [], clientUserMessageId: "message" })).rejects.toThrow("released");
    }
    await dispatched.promise;
    if (stage === "turn/start") cleanup = adapters.threadEphemeral.release();
    current = replacement;
    pending.resolve(stage === "turn/start" ? { turn: { id: "late-turn" } } : {});
    await result;
    await cleanup;
    expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, expect.anything());
    expect(replacement.request).not.toHaveBeenCalled();
  });
});

function adaptersWithSteerError(error: Error) {
  const client = {
    request: vi.fn().mockRejectedValue(error),
  } as unknown as AppServerClient;
  return adaptersWithClient(client);
}

function adaptersWithClient(client: AppServerClient) {
  return createChatSessionAdapters({
    vaultPath: "/vault",
    recordThreadSubscription: vi.fn(),
    currentClient: () => client,
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
