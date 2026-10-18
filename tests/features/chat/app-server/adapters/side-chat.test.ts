import { describe, expect, it, vi } from "vitest";

import { AppServerRpcError } from "../../../../../src/app-server/connection/json-rpc-client";
import type { AppServerRequestClient } from "../../../../../src/app-server/services/request-client";
import { createSideConversation } from "../../../../../src/features/chat/app-server/adapters/side-chat";

import { deferred } from "../../../../support/async";

describe("side-chat app-server adapter", () => {
  it("forks with inherited permissions behind a model-visible boundary", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "config/read") return Promise.resolve({ config: { developer_instructions: "Existing policy." } });
        if (method === "thread/inject_items") return Promise.resolve({});
        return Promise.resolve(sideChatForkResponse());
      }),
    } as unknown as AppServerRequestClient;

    const result = await conversation(client, {
      model: "parent-model",
      permissions: "trusted",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalsReviewer: "user",
    }).activate();

    expect(client.request).toHaveBeenNthCalledWith(1, "config/read", { cwd: "/vault" });
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/fork",
      expect.objectContaining({
        threadId: "source",
        cwd: "/vault",
        ephemeral: true,
        permissions: "trusted",
        model: "parent-model",
        serviceTier: "fast",
        approvalsReviewer: "user",
        config: { model_reasoning_effort: "high" },
        excludeTurns: true,
        developerInstructions: expect.stringContaining("Existing policy."),
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(3, "thread/inject_items", {
      threadId: "side",
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: expect.stringContaining("Side conversation boundary.") }],
        },
      ],
    });
    const forkParams = vi.mocked(client.request).mock.calls[1]?.[1];
    expect(forkParams).not.toHaveProperty("sandbox");
    expect(forkParams).not.toHaveProperty("deferGoalContinuation");
    expect(forkParams).not.toHaveProperty("approvalPolicy");
    expect(JSON.stringify(forkParams)).not.toContain("This thread is read-only");
    expect(JSON.stringify(forkParams)).toContain("Do not use sub-agents");
    expect(JSON.stringify(forkParams)).toContain("The inherited fork history is reference context only.");
    expect(JSON.stringify(forkParams)).toContain("Only instructions submitted after the side-conversation boundary are active.");
    expect(JSON.stringify(forkParams)).toContain(
      "Follow explicit new requests, including edits, using the normal permissions and approval process.",
    );
    const boundary = vi.mocked(client.request).mock.calls[2]?.[1];
    expect(JSON.stringify(boundary)).toContain(
      "Do not continue any instructions, goals, plans, tool calls, approvals, edits, or requests from before this boundary.",
    );
    expect(result).toMatchObject({ thread: { id: "side" } });
  });

  it.each([false, true])("preserves the injection error and releases the fork (cleanup failure=%s)", async (cleanupFails) => {
    const injectionError = new Error("inject failed");
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: {} });
      if (method === "thread/fork") return Promise.resolve(sideChatForkResponse());
      if (method === "thread/inject_items") return Promise.reject(injectionError);
      if (method === "thread/unsubscribe" && cleanupFails) return Promise.reject(new Error("unsubscribe failed"));
      return Promise.resolve({});
    });
    await expect(conversation({ request } as unknown as AppServerRequestClient).activate()).rejects.toBe(injectionError);
    expect(request).toHaveBeenLastCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
  });

  it.each(["interrupt", "unsubscribe"])("reports %s failure while still attempting both cleanup operations", async (failure) => {
    const request = vi.fn(async (method: string) => {
      if (method === "config/read") return { config: {} };
      if (method === "thread/fork") return sideChatForkResponse();
      if (method === `turn/${failure}` || method === `thread/${failure}`) throw new Error(failure);
      return {};
    });
    const releaseRequests = vi.fn();
    const reportCleanupFailure = vi.fn();
    const owner = conversation({ request } as unknown as AppServerRequestClient, {}, { releaseRequests, reportCleanupFailure });
    await owner.activate();
    await expect(owner.release()).rejects.toThrow(failure);
    await expect(owner.disposed).rejects.toThrow(failure);
    await expect(owner.release()).rejects.toThrow(failure);
    expect(request.mock.calls.slice(-2).map(([method]) => method)).toEqual(["turn/interrupt", "thread/unsubscribe"]);
    expect(releaseRequests).toHaveBeenCalledExactlyOnceWith("side");
    expect(reportCleanupFailure).toHaveBeenCalledOnce();
  });

  it.each(["thread/fork", "thread/inject_items"])("retires a conversation while %s is pending", async (pendingMethod) => {
    const pending = deferred<unknown>();
    const dispatched = deferred<void>();
    const request = vi.fn(async (method: string) => {
      if (method === "config/read") return { config: {} };
      if (method === pendingMethod) {
        dispatched.resolve();
        return pending.promise;
      }
      if (method === "thread/fork") return sideChatForkResponse();
      return {};
    });
    const owner = conversation({ request } as unknown as AppServerRequestClient);
    const activating = owner.activate();
    await dispatched.promise;
    const releasing = owner.release();
    pending.resolve(pendingMethod === "thread/fork" ? sideChatForkResponse() : {});
    await expect(activating).resolves.toBeNull();
    await releasing;
    await owner.disposed;
    expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "side", turnId: "" }, { timeoutMs: 1_000 });
    expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
    if (pendingMethod === "thread/fork") expect(request.mock.calls.map(([method]) => method)).not.toContain("thread/inject_items");
  });

  it("does not repeat an interrupt when a pending start has already supplied its turn ID", async () => {
    const pending = deferred<unknown>();
    const dispatched = deferred<void>();
    const interrupted = deferred<void>();
    let currentTurn: { threadId: string; turnId: string } | null = null;
    const request = vi.fn(async (method: string) => {
      if (method === "config/read") return { config: {} };
      if (method === "thread/fork") return sideChatForkResponse();
      if (method === "turn/start") {
        dispatched.resolve();
        return pending.promise;
      }
      if (method === "turn/interrupt") interrupted.resolve();
      return {};
    });
    const owner = conversation({ request } as unknown as AppServerRequestClient, {}, { currentTurn: () => currentTurn });
    await owner.activate();
    const starting = expect(owner.start([], "message")).rejects.toThrow("released");
    await dispatched.promise;
    currentTurn = { threadId: "side", turnId: "late-turn" };
    const releasing = owner.release();
    await interrupted.promise;
    pending.resolve({ turn: { id: "late-turn" } });
    await starting;
    await releasing;
    expect(request.mock.calls.filter(([method]) => method === "turn/interrupt")).toEqual([
      ["turn/interrupt", { threadId: "side", turnId: "late-turn" }, { timeoutMs: 1_000 }],
    ]);
  });
  it.each(["next-start", "compact", "another-thread"] as const)(
    "uses current turn facts rather than the last start response when releasing %s",
    async (phase) => {
      let active: string | null = "turn-a";
      let visible: { threadId: string; turnId: string } | null = { threadId: "side", turnId: "turn-a" };
      const next = deferred<unknown>();
      const request = vi.fn(async (method: string, params?: unknown) => {
        if (method === "config/read") return { config: {} };
        if (method === "thread/fork") return sideChatForkResponse();
        if (method === "turn/start") return active === "turn-a" ? { turn: { id: "turn-a" } } : next.promise;
        if (method === "turn/interrupt") {
          const id = (params as { turnId: string }).turnId;
          // Codex rejects terminal/mismatched IDs before submitting Op::Interrupt.
          if (id && id !== active) throw new Error("no active turn to interrupt");
        }
        return {};
      });
      const reportCleanupFailure = vi.fn();
      const owner = conversation(
        { request } as unknown as AppServerRequestClient,
        {},
        {
          currentTurn: () => visible,
          reportCleanupFailure,
        },
      );
      await owner.activate();
      await owner.start([], "first");
      active = phase === "compact" ? "compact-turn" : phase === "next-start" ? "turn-b" : null;
      visible =
        phase === "compact"
          ? { threadId: "side", turnId: "compact-turn" }
          : phase === "another-thread"
            ? { threadId: "other", turnId: "other-turn" }
            : null;
      const starting = phase === "next-start" ? expect(owner.start([], "second")).rejects.toThrow("released") : null;
      if (starting) await vi.waitFor(() => expect(request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2));
      const releasing = owner.release();
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 }));
      if (starting) next.resolve({ turn: { id: "turn-b" } });
      await starting;
      await releasing;
      expect(request).toHaveBeenCalledWith(
        "turn/interrupt",
        {
          threadId: "side",
          turnId: phase === "compact" ? "compact-turn" : "",
        },
        { timeoutMs: 1_000 },
      );
      if (phase === "next-start") {
        expect(request.mock.calls.filter(([method]) => method === "turn/interrupt" || method === "thread/unsubscribe")).toEqual([
          ["turn/interrupt", { threadId: "side", turnId: "" }, { timeoutMs: 1_000 }],
          ["thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 }],
          ["turn/interrupt", { threadId: "side", turnId: "turn-b" }, { timeoutMs: 1_000 }],
          ["thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 }],
        ]);
      }
      expect(reportCleanupFailure).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown start result", "rejected start"] as const)(
    "distinguishes uncertain cleanup from a definite rejection (%s)",
    async (failure) => {
      const started = deferred<unknown>();
      const dispatched = deferred<void>();
      const error =
        failure === "rejected start"
          ? new AppServerRpcError("turn/start", { code: -32000, message: "Start rejected" })
          : new Error("Transport timed out");
      const request = vi.fn(async (method: string) => {
        if (method === "config/read") return { config: {} };
        if (method === "thread/fork") return sideChatForkResponse();
        if (method === "turn/start") {
          dispatched.resolve();
          return started.promise;
        }
        return {};
      });
      const reportCleanupFailure = vi.fn();
      const owner = conversation({ request } as unknown as AppServerRequestClient, {}, { reportCleanupFailure });
      await owner.activate();
      const starting = expect(owner.start([], "message")).rejects.toBe(error);
      await dispatched.promise;
      const releasing = owner.release();
      const cleanup = failure === "rejected start" ? expect(releasing).resolves.toBeUndefined() : expect(releasing).rejects.toBe(error);
      started.reject(error);
      await starting;
      await cleanup;
      expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
      expect(reportCleanupFailure).toHaveBeenCalledTimes(failure === "rejected start" ? 0 : 1);
    },
  );

  it("uses the inherited sandbox fallback when no named permission profile is known", async () => {
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: {} });
      if (method === "thread/fork") return Promise.resolve(sideChatForkResponse());
      return Promise.resolve({});
    });
    await conversation({ request } as unknown as AppServerRequestClient, {
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/vault"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      approvalPolicy: "on-request",
    }).activate();
    expect(request).toHaveBeenCalledWith(
      "thread/fork",
      expect.objectContaining({ sandbox: "workspace-write", approvalPolicy: "on-request" }),
    );
  });
});

function sideChatForkResponse() {
  return {
    thread: { id: "side", preview: "", name: null, createdAt: 1, updatedAt: 1 },
    cwd: "/vault",
    model: "gpt-5.5",
    serviceTier: null,
    approvalsReviewer: null,
    reasoningEffort: null,
    approvalPolicy: "never",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
  };
}

function conversation(
  client: AppServerRequestClient,
  runtime: Parameters<typeof createSideConversation>[0]["runtime"] = {},
  overrides: Partial<Parameters<typeof createSideConversation>[0]> = {},
) {
  return createSideConversation({
    client,
    sourceThreadId: "source",
    vaultPath: "/vault",
    runtime,
    releaseRequests: vi.fn(),
    reportCleanupFailure: vi.fn(),
    isCurrent: () => true,
    ...overrides,
  });
}
