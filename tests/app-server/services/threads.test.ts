import { describe, expect, it, vi } from "vitest";

import type { ThreadRecord } from "../../../src/app-server/protocol/thread";
import type { TurnItem, TurnRecord } from "../../../src/app-server/protocol/turn";
import type { AppServerRequestClient } from "../../../src/app-server/services/request-client";
import {
  listThreads,
  readThreadForArchiveExport,
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

  it.each([
    ["legacy", "legacy"],
    ["paginated", "paginated"],
    [undefined, "unknown"],
    ["future-mode", "unknown"],
  ] as const)("normalizes app-server history mode %s", (historyMode, expected) => {
    const thread = threadFromAppServerRecord({
      id: "thread",
      preview: "",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      ...(historyMode === undefined ? {} : { historyMode }),
    });

    expect(thread.historyMode).toBe(expected);
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
      historyMode: "paginated",
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
      historyMode: "paginated",
      serviceTier: "priority",
    });
  });

  it("reads every paginated turn and item page for archive export", async () => {
    const request = vi.fn((method: string, params: { cursor?: string | null }) => {
      if (method === "thread/read") return Promise.resolve({ thread: archiveThread("paginated") });
      if (method === "thread/turns/list") {
        return params.cursor === null
          ? Promise.resolve({ data: [archiveTurn("turn-1")], nextCursor: "turn-page-2", backwardsCursor: null })
          : Promise.resolve({ data: [archiveTurn("turn-2")], nextCursor: null, backwardsCursor: null });
      }
      if (method === "thread/items/list") {
        return params.cursor === null
          ? Promise.resolve({
              data: [{ turnId: "turn-1", item: userMessage("user-1", "First question") }],
              nextCursor: "item-page-2",
              backwardsCursor: null,
            })
          : Promise.resolve({
              data: [
                { turnId: "turn-1", item: agentMessage("agent-1", "First answer") },
                { turnId: "turn-2", item: userMessage("user-2", "Second question") },
                { turnId: "turn-2", item: agentMessage("agent-2", "Second answer") },
              ],
              nextCursor: null,
              backwardsCursor: null,
            });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const client = { request } as unknown as AppServerRequestClient;

    const archived = await readThreadForArchiveExport(client, "thread");

    expect(archived.historyMode).toBe("paginated");
    expect(archived.transcriptEntries).toEqual([
      { kind: "user", text: "First question", timestamp: 1 },
      { kind: "assistant", text: "First answer", timestamp: 2 },
      { kind: "user", text: "Second question", timestamp: 1 },
      { kind: "assistant", text: "Second answer", timestamp: 2 },
    ]);
    expect(request).toHaveBeenNthCalledWith(1, "thread/read", { threadId: "thread", includeTurns: false });
    expect(request).toHaveBeenNthCalledWith(2, "thread/turns/list", {
      threadId: "thread",
      cursor: null,
      limit: 100,
      sortDirection: "asc",
      itemsView: "notLoaded",
    });
    expect(request).toHaveBeenNthCalledWith(4, "thread/items/list", {
      threadId: "thread",
      cursor: null,
      limit: 100,
      sortDirection: "asc",
    });
  });

  it("retains the includeTurns compatibility path for legacy archives", async () => {
    const legacy = archiveThread("legacy", [archiveTurn("turn-1", [userMessage("user", "Legacy prompt")])]);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ thread: archiveThread("legacy") })
      .mockResolvedValueOnce({ thread: legacy });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(readThreadForArchiveExport(client, "thread")).resolves.toMatchObject({
      historyMode: "legacy",
      transcriptEntries: [{ kind: "user", text: "Legacy prompt" }],
    });
    expect(request).toHaveBeenNthCalledWith(1, "thread/read", { threadId: "thread", includeTurns: false });
    expect(request).toHaveBeenNthCalledWith(2, "thread/read", { threadId: "thread", includeTurns: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated archive pagination cursors", async () => {
    const request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: archiveThread("paginated") });
      if (method === "thread/turns/list") {
        return Promise.resolve({ data: [], nextCursor: "same", backwardsCursor: null });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(readThreadForArchiveExport(client, "thread")).rejects.toThrow("repeated archive turn cursor");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects repeated archive item cursors", async () => {
    const request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: archiveThread("paginated") });
      if (method === "thread/turns/list") {
        return Promise.resolve({ data: [archiveTurn("turn-1")], nextCursor: null, backwardsCursor: null });
      }
      if (method === "thread/items/list") {
        return Promise.resolve({ data: [], nextCursor: "same", backwardsCursor: null });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(readThreadForArchiveExport(client, "thread")).rejects.toThrow("repeated archive item cursor");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects archive items that reference an unknown turn", async () => {
    const request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: archiveThread("paginated") });
      if (method === "thread/turns/list") {
        return Promise.resolve({ data: [archiveTurn("turn-1")], nextCursor: null, backwardsCursor: null });
      }
      if (method === "thread/items/list") {
        return Promise.resolve({
          data: [{ turnId: "missing-turn", item: userMessage("user", "Orphaned") }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(readThreadForArchiveExport(client, "thread")).rejects.toThrow("archive item for unknown turn missing-turn");
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
        historyMode: "unknown",
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
        historyMode: "unknown",
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
        historyMode: "unknown",
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
        historyMode: "unknown",
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
        historyMode: "unknown",
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

function archiveThread(historyMode: "legacy" | "paginated", turns: readonly TurnRecord[] = []): ThreadRecord {
  return {
    id: "thread",
    historyMode,
    preview: "Archive",
    name: "Archive",
    createdAt: 1,
    updatedAt: 2,
    turns,
  };
}

function archiveTurn(id: string, items: readonly TurnItem[] = []): TurnRecord {
  return {
    id,
    items: [...items],
    itemsView: items.length > 0 ? "full" : "notLoaded",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1_000,
  };
}

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: null, memoryCitation: null };
}
