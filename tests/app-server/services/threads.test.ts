import { describe, expect, it, vi } from "vitest";

import type { AppServerRequestClient } from "../../../src/app-server/services/request-client";
import { listThreads, startThread, threadFromAppServerRecord, unsubscribeThread } from "../../../src/app-server/services/threads";

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
            agent_path: "/root/scout",
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
      agentPath: "/root/scout",
      agentNickname: "Scout",
      agentRole: "explorer",
    });
  });

  it("excludes subagent and ephemeral records from thread lists", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [
          { id: "interactive", preview: "Keep", name: null, createdAt: 1, updatedAt: 1 },
          {
            id: "child",
            preview: "Hide",
            name: null,
            createdAt: 1,
            updatedAt: 1,
            parentThreadId: "parent",
            source: { subAgent: { thread_spawn: { parent_thread_id: "parent" } } },
          },
          { id: "side", preview: "Hide", name: null, createdAt: 1, updatedAt: 1, ephemeral: true },
        ],
      }),
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).resolves.toMatchObject([{ id: "interactive" }]);
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

  it("unsubscribes ephemeral threads instead of deleting them", async () => {
    const client = { request: vi.fn().mockResolvedValue({ status: "unsubscribed" }) } as unknown as AppServerRequestClient;

    await unsubscribeThread(client, "side", { timeoutMs: 5_000 });

    expect(client.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
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
