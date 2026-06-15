import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import { listThreads } from "../../src/app-server/threads/data";

describe("app-server thread data adapters", () => {
  it("maps listed threads to domain threads with archive state", async () => {
    const clientListThreads = vi.fn().mockResolvedValue({
      data: [{ id: "thread-1", preview: "Preview", name: null, createdAt: 10, updatedAt: 20 }],
    });
    const client = {
      listThreads: clientListThreads,
    } as unknown as AppServerClient;

    await expect(listThreads(client, "/vault", { archived: true })).resolves.toEqual([
      { id: "thread-1", preview: "Preview", name: null, archived: true, createdAt: 10, updatedAt: 20 },
    ]);
    expect(clientListThreads).toHaveBeenCalledWith("/vault", { archived: true, cursor: null, limit: 100 });
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
      listThreads: clientListThreads,
    } as unknown as AppServerClient;

    await expect(listThreads(client, "/vault")).resolves.toEqual([
      { id: "thread-1", preview: "First", name: null, archived: false, createdAt: 10, updatedAt: 20 },
      { id: "thread-2", preview: "Second", name: null, archived: false, createdAt: 30, updatedAt: 40 },
    ]);
    expect(clientListThreads).toHaveBeenNthCalledWith(1, "/vault", { archived: false, cursor: null, limit: 100 });
    expect(clientListThreads).toHaveBeenNthCalledWith(2, "/vault", { archived: false, cursor: "next", limit: 100 });
  });

  it("rejects repeated thread list cursors", async () => {
    const client = {
      listThreads: vi.fn().mockResolvedValue({
        data: [],
        nextCursor: "same",
      }),
    } as unknown as AppServerClient;

    await expect(listThreads(client, "/vault")).rejects.toThrow("repeated thread list cursor");
  });
});
