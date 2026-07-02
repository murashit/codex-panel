import { describe, expect, it, vi } from "vitest";

import type { AppServerRequestClient } from "../../src/app-server/services/request-client";
import { listThreads, startEphemeralThread, startThread } from "../../src/app-server/services/threads";

describe("app-server thread response adapters", () => {
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

  it("starts ephemeral helper threads without deprecated multi-agent mode params", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ thread: { id: "thread-new" } }),
    } as unknown as AppServerRequestClient;

    await startEphemeralThread(client, {
      cwd: "/vault",
      serviceName: "codex-panel-selection-rewrite",
      developerInstructions: "Return structured output.",
    });

    expect(client.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/vault",
      serviceName: "codex-panel-selection-rewrite",
      developerInstructions: "Return structured output.",
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      environments: [],
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
      { id: "thread-1", preview: "Preview", name: null, archived: true, createdAt: 10, updatedAt: 20 },
    ]);
    expect(clientListThreads).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault",
      archived: true,
      limit: 100,
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
      { id: "thread-1", preview: "Preview", name: null, archived: false, createdAt: 10, updatedAt: 20, recencyAt: 30 },
    ]);
  });

  it("preserves nullable app-server recency timestamps", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20, recencyAt: null }],
      }),
    } as unknown as AppServerRequestClient;

    await expect(listThreads(client, "/vault")).resolves.toEqual([
      { id: "thread-1", preview: "Preview", name: null, archived: false, createdAt: 10, updatedAt: 20, recencyAt: null },
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
      { id: "thread-1", preview: "First", name: null, archived: false, createdAt: 10, updatedAt: 20 },
      { id: "thread-2", preview: "Second", name: null, archived: false, createdAt: 30, updatedAt: 40 },
    ]);
    expect(clientListThreads).toHaveBeenNthCalledWith(1, "thread/list", {
      cwd: "/vault",
      archived: false,
      limit: 100,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    expect(clientListThreads).toHaveBeenNthCalledWith(2, "thread/list", {
      cwd: "/vault",
      cursor: "next",
      archived: false,
      limit: 100,
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
