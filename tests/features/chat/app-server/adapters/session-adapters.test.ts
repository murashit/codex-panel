import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { AppServerRpcError } from "../../../../../src/app-server/connection/json-rpc-client";
import { ThreadSubscriptions } from "../../../../../src/app-server/connection/thread-subscriptions";
import { createChatSessionAdapters } from "../../../../../src/features/chat/app-server/adapters/session-adapters";
import { appServerThreadFixture } from "../../../../support/app-server-records";
import { deferred, waitForAsyncWork } from "../../../../support/async";

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
  it.each(["persistent-start", "temporary-start", "side-fork", "side-injection", "injection-failure"] as const)(
    "releases an unadopted root through the shared owner without interrupting (%s)",
    async (stage) => {
      const pending = deferred<unknown>();
      const reached = deferred<void>();
      const heldMethod = stage.endsWith("start") ? "thread/start" : stage === "side-fork" ? "thread/fork" : "thread/inject_items";
      const response = {
        thread: appServerThreadFixture({
          id: "created",
          sessionId: "session",
          preview: "",
          ephemeral: stage !== "persistent-start",
          historyMode: "paginated",
          modelProvider: "openai",
          createdAt: 1,
          updatedAt: 1,
          status: { type: "idle" },
          cwd: "/vault",
          cliVersion: "0.163.0",
          source: "cli",
          turns: [],
        }),
      };
      const request = vi.fn((method: string) => {
        if (method === heldMethod) {
          reached.resolve();
          return pending.promise;
        }
        if (method === "config/read") return Promise.resolve({ config: {} });
        if (method === "thread/fork") return Promise.resolve(response);
        return Promise.resolve({});
      });
      const original = { request } as unknown as AppServerClient;
      const replacement = { request: vi.fn() } as unknown as AppServerClient;
      let presented = true;
      const failure = vi.fn();
      const subscriptions = new ThreadSubscriptions(
        () => original,
        () => [],
        failure,
      );
      const adapters = createChatSessionAdapters({
        vaultPath: "/vault",
        currentClient: () => (presented ? original : replacement),
        recordThreadSubscription: (id, client) => subscriptions.record(id, client),
      });
      const creating = subscriptions.activate(null, () =>
        stage.endsWith("start")
          ? adapters.threadStart.startThread({ ephemeral: stage === "temporary-start" })
          : adapters.threadStart.forkSideChat("parent", {}, () => presented),
      );
      const result =
        stage === "injection-failure" ? expect(creating).rejects.toThrow("boundary failed") : expect(creating).resolves.toBeDefined();
      await reached.promise;
      // Close/replacement invalidates adoption while keeping shared connection bookkeeping alive.
      presented = false;
      if (stage === "injection-failure") pending.reject(new Error("boundary failed"));
      else pending.resolve(heldMethod === "thread/inject_items" ? {} : response);
      await result;
      await waitForAsyncWork(() => expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "created" }, expect.anything()));
      expect(request.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
      expect(replacement.request).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
    },
  );
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
