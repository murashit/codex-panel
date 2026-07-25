import { describe, expect, it, vi } from "vitest";

import type { AppServerRequestClient } from "../../../src/app-server/services/request-client";
import {
  EphemeralThreadCleanupRequiredError,
  forkEphemeralThread,
  listThreads,
  startThread,
  threadFromAppServerRecord,
  unsubscribeThread,
} from "../../../src/app-server/services/threads";

describe("app-server thread response adapters", () => {
  it("preserves spawned subagent provenance in the domain thread", () => {
    const thread = threadFromAppServerRecord({
      id: "child",
      preview: "Inspect",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      sessionId: "session",
      parentThreadId: "parent",
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "parent",
            depth: 2,
            agent_path: null,
            agent_nickname: "Scout",
            agent_role: "explorer",
          },
        },
      },
      agentNickname: "Scout",
      agentRole: "explorer",
    });

    expect(thread.provenance).toEqual({
      kind: "subagent",
      subagentKind: "thread-spawn",
      parentThreadId: "parent",
      sessionId: "session",
      depth: 2,
      agentNickname: "Scout",
      agentRole: "explorer",
    });
  });

  it("preserves direct-input capability from app-server threads", () => {
    const thread = threadFromAppServerRecord({
      id: "thread",
      preview: "",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      canAcceptDirectInput: false,
    });

    expect(thread.canAcceptDirectInput).toBe(false);
  });

  it("forks read-only ephemeral side-chat threads behind a model-visible boundary", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "config/read") return Promise.resolve({ config: { developer_instructions: "Existing policy." } });
        if (method === "thread/inject_items") return Promise.resolve({});
        return Promise.resolve({
          thread: { id: "side", preview: "", name: null, createdAt: 1, updatedAt: 1 },
          cwd: "/vault",
          model: "gpt-5.5",
          serviceTier: null,
          approvalsReviewer: null,
          reasoningEffort: null,
          approvalPolicy: "never",
          sandbox: { type: "readOnly", networkAccess: false },
          activePermissionProfile: null,
        });
      }),
    } as unknown as AppServerRequestClient;

    const result = await forkEphemeralThread(client, "source", "/vault");

    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/fork",
      expect.objectContaining({
        threadId: "source",
        cwd: "/vault",
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        excludeTurns: true,
        developerInstructions: expect.stringContaining("Existing policy."),
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(1, "config/read", { cwd: "/vault" });
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
    expect(result).toMatchObject({ sourceThreadId: "source", activation: { thread: { id: "side" } } });
  });

  it("unsubscribes ephemeral threads instead of deleting them", async () => {
    const client = { request: vi.fn().mockResolvedValue({ status: "unsubscribed" }) } as unknown as AppServerRequestClient;

    await unsubscribeThread(client, "side", { timeoutMs: 5_000 });

    expect(client.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
  });

  it("unsubscribes a fork when boundary injection fails", async () => {
    const injectionError = new Error("inject failed");
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: { developer_instructions: null } });
      if (method === "thread/fork") {
        return Promise.resolve({
          thread: { id: "side", preview: "", name: null, createdAt: 1, updatedAt: 1 },
          cwd: "/vault",
          model: "gpt-5.5",
          serviceTier: null,
          approvalsReviewer: null,
          reasoningEffort: null,
          approvalPolicy: "never",
          sandbox: { type: "readOnly", networkAccess: false },
          activePermissionProfile: null,
        });
      }
      if (method === "thread/inject_items") return Promise.reject(injectionError);
      return Promise.resolve({ status: "unsubscribed" });
    });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(forkEphemeralThread(client, "source", "/vault")).rejects.toBe(injectionError);

    expect(request).toHaveBeenLastCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
  });

  it("returns the fork id when boundary injection and cleanup both fail", async () => {
    const injectionError = new Error("inject failed");
    const cleanupError = new Error("unsubscribe failed");
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: { developer_instructions: null } });
      if (method === "thread/fork") {
        return Promise.resolve({
          thread: { id: "side", preview: "", name: null, createdAt: 1, updatedAt: 1 },
          cwd: "/vault",
          model: "gpt-5.5",
          serviceTier: null,
          approvalsReviewer: null,
          reasoningEffort: null,
          approvalPolicy: "never",
          sandbox: { type: "readOnly", networkAccess: false },
          activePermissionProfile: null,
        });
      }
      if (method === "thread/inject_items") return Promise.reject(injectionError);
      return Promise.reject(cleanupError);
    });
    const client = { request } as unknown as AppServerRequestClient;

    const error = await forkEphemeralThread(client, "source", "/vault").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(EphemeralThreadCleanupRequiredError);
    expect(error).toMatchObject({ threadId: "side", cause: injectionError, cleanupError });
  });

  it("starts panel-owned threads with the codex-panel service name", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ thread: { id: "thread-new" } }),
    } as unknown as AppServerRequestClient;

    await startThread(client, { cwd: "/vault" });

    expect(client.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/vault",
      serviceName: "codex-panel",
    });
  });

  it("stops a complete thread-list scan before requesting another page after cancellation", async () => {
    const firstPage = deferred<{ data: never[]; nextCursor: string }>();
    const request = vi.fn().mockImplementationOnce(() => firstPage.promise);
    const client = { request } as unknown as AppServerRequestClient;
    const abort = new AbortController();

    const scan = listThreads(client, "/vault", { signal: abort.signal });
    abort.abort();
    firstPage.resolve({ data: [], nextCursor: "page-2" });

    await expect(scan).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("passes explicit service tier requests when starting panel-owned threads", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ thread: { id: "thread-new" } }),
    } as unknown as AppServerRequestClient;

    await startThread(client, { cwd: "/vault", serviceTier: "priority" });

    expect(client.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/vault",
      serviceName: "codex-panel",
      serviceTier: "priority",
    });
  });

  it("maps listed threads to domain threads with archive state", async () => {
    const clientListThreads = vi.fn().mockResolvedValue({
      data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20 }],
    });
    const client = {
      request: clientListThreads,
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault", { archived: true })).resolves.toEqual([
      {
        id: "thread-1",
        preview: "Preview",
        name: null,
        archived: true,
        createdAt: 10,
        updatedAt: 20,
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
      },
    ]);
    expect(clientListThreads).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault",
      archived: true,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("preserves app-server recency timestamps when available", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20, recencyAt: 30 }],
      }),
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).resolves.toEqual([
      {
        id: "thread-1",
        preview: "Preview",
        name: null,
        archived: false,
        createdAt: 10,
        updatedAt: 20,
        recencyAt: 30,
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
      },
    ]);
  });

  it("preserves nullable app-server recency timestamps", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20, recencyAt: null }],
      }),
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).resolves.toEqual([
      {
        id: "thread-1",
        preview: "Preview",
        name: null,
        archived: false,
        createdAt: 10,
        updatedAt: 20,
        recencyAt: null,
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
      },
    ]);
  });

  it("follows thread list pagination until the final page", async () => {
    const clientListThreads = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "thread-1", preview: "First", name: null, createdAt: 10, updatedAt: 20 }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        data: [{ id: "thread-2", preview: "Second", name: null, createdAt: 30, updatedAt: 40 }],
        nextCursor: null,
      });
    const client = {
      request: clientListThreads,
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).resolves.toEqual([
      {
        id: "thread-1",
        preview: "First",
        name: null,
        archived: false,
        createdAt: 10,
        updatedAt: 20,
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
      },
      {
        id: "thread-2",
        preview: "Second",
        name: null,
        archived: false,
        createdAt: 30,
        updatedAt: 40,
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
      },
    ]);
    expect(clientListThreads).toHaveBeenNthCalledWith(1, "thread/list", {
      cwd: "/vault",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    expect(clientListThreads).toHaveBeenNthCalledWith(2, "thread/list", {
      cwd: "/vault",
      cursor: "next",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("rejects repeated thread list cursors", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [],
        nextCursor: "same",
      }),
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).rejects.toThrow("repeated thread list cursor");
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
