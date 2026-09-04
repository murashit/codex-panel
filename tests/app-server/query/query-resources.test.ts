import { onlineManager } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import type { AppServerClientAccess } from "../../../src/app-server/connection/client-access";
import type { AppServerExecutionContext } from "../../../src/app-server/connection/execution-context";
import {
  type CatalogHookMetadata,
  type CatalogModel,
  type CatalogSkillMetadata,
  hookItemsFromCatalogHooks,
} from "../../../src/app-server/protocol/catalog";
import { AppServerMetadataQueries } from "../../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../../src/app-server/query/query-scope";
import { AppServerThreadCatalog } from "../../../src/app-server/query/thread-catalog-queries";
import type { RateLimitSnapshot } from "../../../src/domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../../src/domain/runtime/permissions";
import type { Thread } from "../../../src/domain/threads/model";

describe("app-server query resources", () => {
  it("copies its execution context before performing requests", async () => {
    const context = { codexPath: "/opt/codex", vaultPath: "/vault-a" };
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "threadSection/list") return { data: [{ id: "pinned", name: "Pinned" }], nextCursor: null };
      if (method === "thread/list" && (params as { sectionId?: string }).sectionId === "pinned") return { data: [], nextCursor: null };
      return { data: [], nextCursor: null };
    });
    const cache = createCache({ withClient: async (operation) => operation({ request } as never) }, context);

    context.codexPath = "/changed";
    context.vaultPath = "/vault-b";
    await cache.threadCatalog.fetchActiveThreads();

    expect(request).toHaveBeenCalledWith("threadSection/list", { cursor: null, limit: 100 });
    expect(request).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault-a",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    expect(request).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault-a",
      archived: false,
      sectionId: "pinned",
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("tears down observers without notifying them after disposal", async () => {
    const pending = deferred<readonly []>();
    const cache = createCache({
      withClient: vi.fn(() => pending.promise) as AppServerClientAccess["withClient"],
    });
    const listener = vi.fn();
    cache.metadataQueries.observeMetadataResource("models", listener, { emitCurrent: false });

    const fetch = cache.metadataQueries.fetchModels();
    listener.mockClear();
    cache.scope.dispose();
    pending.resolve([]);
    await fetch.catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);

    await cache.threadCatalog.refreshActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
  });

  it("reuses a successful active thread query until it is explicitly invalidated", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([thread("cached")]);
    const cache = cacheWithThreads(fetchThreads);

    await cache.threadCatalog.fetchActiveThreads();
    await expect(cache.threadCatalog.fetchActiveThreads()).resolves.toEqual([thread("cached")]);

    expect(fetchThreads).toHaveBeenCalledOnce();
  });

  it("preserves the last-known-good active thread list when a refresh fails", async () => {
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([{ ...thread("target"), name: "cached" }])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ ...thread("target"), name: "refreshed" }]);
    const cache = cacheWithThreads(fetchThreads);
    await cache.threadCatalog.refreshActiveThreads();

    await expect(cache.threadCatalog.refreshActiveThreads()).rejects.toThrow("offline");
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "target", changes: { name: "from-event" } },
    ]);
    expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("from-event");
    await expect(cache.threadCatalog.fetchActiveThreads()).resolves.toEqual([{ ...thread("target"), name: "refreshed" }]);
  });

  it("shares concurrent active thread refreshes within one resource identity", async () => {
    const pending = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi.fn(() => pending.promise);
    const cache = cacheWithThreads(fetchThreads);

    const first = cache.threadCatalog.refreshActiveThreads();
    const second = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();

    expect(fetchThreads).toHaveBeenCalledOnce();
    pending.resolve([thread("shared")]);
    await Promise.all([first, second]);
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("shared")]);
  });

  it("keeps the visible active thread snapshot stable while replacement publication is frozen", async () => {
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([thread("source")])
      .mockResolvedValueOnce([thread("replacement")]);
    const cache = cacheWithThreads(fetchThreads);
    await cache.threadCatalog.refreshActiveThreads();

    const release = cache.threadCatalog.freezeActiveThreads();

    await cache.threadCatalog.refreshActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("source")]);
    expect(fetchThreads).toHaveBeenCalledOnce();

    release();
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("replacement")]));
  });

  it("does not retry a cancelled initial active thread refresh while visibility is frozen", async () => {
    const staleRequest = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi
      .fn()
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce([thread("replacement")]);
    const cache = cacheWithThreads(fetchThreads);
    const initialRefresh = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();

    const release = cache.threadCatalog.freezeActiveThreads();

    await initialRefresh;
    expect(fetchThreads).toHaveBeenCalledOnce();
    release();
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("replacement")]));

    staleRequest.resolve([thread("source"), thread("replacement")]);
    await flushMicrotasks();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("replacement")]);
  });

  it("keeps active and archived thread list snapshots separate", async () => {
    const fetchThreads = vi.fn((_context: AppServerExecutionContext, archived: boolean) =>
      Promise.resolve(archived ? [thread("archived", true)] : [thread("active")]),
    );
    const cache = cacheWithThreads(fetchThreads);

    await cache.threadCatalog.refreshActiveThreads();
    await expect(cache.threadCatalog.refreshArchivedThreads()).resolves.toEqual([thread("archived", true)]);

    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("active")]);
    expect(cache.threadCatalog.archivedThreadsSnapshot()).toEqual([thread("archived", true)]);
    expect(fetchThreads).toHaveBeenNthCalledWith(1, cacheContext(), false);
    expect(fetchThreads).toHaveBeenNthCalledWith(2, cacheContext(), true);
  });

  it("loads active thread history one page at a time", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    await cache.threadCatalog.refreshActiveThreads();
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
    expect(listThreads).toHaveBeenCalledOnce();

    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "update", list: "active", threadId: "first", changes: { name: "renamed" } }]);
    await cache.threadCatalog.loadMoreActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([{ ...thread("first"), name: "renamed" }, thread("second")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(false);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()).toEqual([{ ...thread("first"), name: "renamed" }]);
    expect(listThreads).toHaveBeenNthCalledWith(2, {
      cwd: "/vault",
      cursor: "page-2",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("loads every pinned thread before paginating unpinned history", async () => {
    const listThreads = vi.fn((params: unknown) => {
      const request = params as { sectionId?: string; cursor?: string };
      if (request.sectionId === "pinned") {
        return request.cursor === "pinned-page-2"
          ? Promise.resolve({ data: [{ ...thread("older-pinned"), section: { id: "pinned", name: "Pinned" } }], nextCursor: null })
          : Promise.resolve({
              data: [{ ...thread("pinned"), section: { id: "pinned", name: "Pinned" } }],
              nextCursor: "pinned-page-2",
            });
      }
      if (request.cursor === "page-2") return Promise.resolve({ data: [thread("older")], nextCursor: null });
      return Promise.resolve({
        data: [{ ...thread("pinned"), section: { id: "pinned", name: "Pinned" } }, thread("recent")],
        nextCursor: "page-2",
      });
    });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads }, cacheContext(), { exposePinnedFilters: true });

    await cache.threadCatalog.refreshActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toMatchObject([
      { id: "pinned", isPinned: true },
      { id: "older-pinned", isPinned: true },
      { id: "recent" },
    ]);
    await cache.threadCatalog.loadMoreActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toMatchObject([
      { id: "pinned", isPinned: true },
      { id: "older-pinned", isPinned: true },
      { id: "recent" },
      { id: "older" },
    ]);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()?.map((thread) => thread.id)).toEqual(["pinned", "older-pinned", "recent"]);
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "pinned" }));
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "pinned", cursor: "pinned-page-2" }));
    expect(listThreads).toHaveBeenCalledWith(expect.not.objectContaining({ sectionId: expect.anything() }));
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ cursor: "page-2" }));
  });

  it("moves an opened older thread to the front without discarding loaded history", async () => {
    const recent = { ...thread("recent"), recencyAt: 20 };
    const older = { ...thread("older"), recencyAt: 10 };
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [recent], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [older], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();
    await cache.threadCatalog.loadMoreActiveThreads();

    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "update", list: "active", threadId: "older", changes: { recencyAt: 30 } }]);

    expect(cache.threadCatalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["older", "recent"]);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["older"]);
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("keeps the recent window stable across event projections", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();
    await cache.threadCatalog.loadMoreActiveThreads();

    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: { ...thread("new"), recencyAt: 30 } }]);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["new"]);

    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "remove", list: "active", threadId: "new" },
      { kind: "remove", list: "active", threadId: "first" },
    ]);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["second"]);
  });

  it("shares concurrent Load more requests through the InfiniteQuery", async () => {
    const nextPage = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockImplementationOnce(() => nextPage.promise);
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();

    const first = cache.threadCatalog.loadMoreActiveThreads();
    const second = cache.threadCatalog.loadMoreActiveThreads();
    await flushMicrotasks();

    expect(listThreads).toHaveBeenCalledTimes(2);
    nextPage.resolve({ data: [thread("second")], nextCursor: null });
    await Promise.all([first, second]);
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("first"), thread("second")]);
  });

  it("does not append a stale load-more page after a newer first-page refresh", async () => {
    const oldPage = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first")], nextCursor: "old-page-2" })
      .mockImplementationOnce(() => oldPage.promise)
      .mockResolvedValueOnce({ data: [thread("new-first")], nextCursor: "new-page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();

    const loadMore = cache.threadCatalog.loadMoreActiveThreads();
    await flushMicrotasks();
    await cache.threadCatalog.refreshActiveThreads();
    oldPage.resolve({ data: [thread("old-second")], nextCursor: null });

    await loadMore;
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("new-first")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
  });

  it("does not append a load-more page invalidated by an exact event", async () => {
    const oldPage = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockImplementationOnce(() => oldPage.promise)
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();

    const loadMore = cache.threadCatalog.loadMoreActiveThreads();
    await flushMicrotasks();
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "remove", list: "active", threadId: "deleted-on-page-2" }]);
    oldPage.resolve({ data: [thread("deleted-on-page-2")], nextCursor: null });

    await loadMore;
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("first")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
  });

  it("projects an exact event without preserving a synthetic page boundary", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first"), thread("old-second")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("new-first"), thread("old-first")], nextCursor: "page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();

    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: thread("new-first") }]);
    expect(cache.threadCatalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["new-first", "old-first", "old-second"]);
    expect(listThreads).toHaveBeenCalledOnce();

    await cache.threadCatalog.refreshActiveThreads();

    expect(cache.threadCatalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["new-first", "old-first"]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
  });

  it("refreshes a structurally invalidated cursor chain before loading more", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first")], nextCursor: "old-page-2" })
      .mockResolvedValueOnce({ data: [thread("event-thread")], nextCursor: "new-page-2" })
      .mockResolvedValueOnce({ data: [thread("new-second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: thread("event-thread") }]);

    await cache.threadCatalog.loadMoreActiveThreads();
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("event-thread"), thread("new-second")]);
    expect(listThreads).toHaveBeenNthCalledWith(3, {
      cwd: "/vault",
      cursor: "new-page-2",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("updates a loaded thread in place instead of inventing a new rank", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();
    await cache.threadCatalog.loadMoreActiveThreads();

    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "upsert", list: "active", thread: { ...thread("second"), name: "Updated without re-ranking" } },
    ]);

    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([
      thread("first"),
      { ...thread("second"), name: "Updated without re-ranking" },
    ]);
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("preserves an in-flight refresh after applying an exact event", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ ...thread("target"), name: "initial" }], nextCursor: null })
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({ data: [{ ...thread("target"), name: "authoritative" }], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();

    const refresh = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "target", changes: { name: "from-event" } },
    ]);

    expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("from-event");
    staleRead.resolve({ data: [{ ...thread("target"), name: "stale" }], nextCursor: null });
    await refresh;
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative"));
    expect(listThreads).toHaveBeenCalledTimes(3);
  });

  it("revalidates after an exact event cancels an initial thread read", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({ data: [{ ...thread("target"), name: "authoritative" }], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const initial = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "target", changes: { name: "from-event" } },
    ]);
    staleRead.resolve({ data: [{ ...thread("target"), name: "stale" }], nextCursor: null });

    await initial;
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative"));
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("refetches after an exact lifecycle fact arrives following an initial thread read failure", async () => {
    const listThreads = vi
      .fn()
      .mockRejectedValueOnce(new Error("threads offline"))
      .mockResolvedValueOnce({ data: [thread("created")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    await expect(cache.threadCatalog.refreshActiveThreads()).rejects.toThrow("threads offline");
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: thread("created") }]);

    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("created")]));
  });

  it("keeps a thread-picker inventory read out of the shared recent list", async () => {
    const oldInventory = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldInventory.promise)
      .mockResolvedValueOnce({ data: [thread("new-first")], nextCursor: "new-page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const inventory = cache.threadCatalog.fetchActiveThreadSearchInventory();
    await flushMicrotasks();
    await cache.threadCatalog.refreshActiveThreads();
    oldInventory.resolve({ data: [thread("old")], nextCursor: null });

    await expect(inventory).resolves.toEqual([thread("old")]);
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("new-first")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
  });

  it("refreshes the complete thread-picker inventory for each operation", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: null })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    await expect(cache.threadCatalog.fetchActiveThreadSearchInventory()).resolves.toEqual([thread("first")]);
    await expect(cache.threadCatalog.fetchActiveThreadSearchInventory()).resolves.toEqual([thread("second")]);

    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("treats a thread-picker inventory as an operation-local snapshot", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("cached")], nextCursor: null })
      .mockImplementationOnce(() => staleRead.promise);
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.fetchActiveThreadSearchInventory();

    const inventory = cache.threadCatalog.fetchActiveThreadSearchInventory();
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "update", list: "active", threadId: "event", changes: { name: "changed" } }]);
    staleRead.resolve({ data: [thread("operation-snapshot")], nextCursor: null });

    await expect(inventory).resolves.toEqual([thread("operation-snapshot")]);
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("runs local app-server queries independently of browser network state", async () => {
    const listModels = vi.fn().mockResolvedValue({ data: [catalogModel("local")] });
    const cache = cacheWithRequestHandlers({ "model/list": listModels });
    onlineManager.setOnline(false);

    try {
      await expect(cache.metadataQueries.fetchModels()).resolves.toMatchObject([{ model: "local" }]);
      expect(listModels).toHaveBeenCalledOnce();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("clears snapshots and rejects new reads after disposal", async () => {
    const listModels = vi.fn().mockResolvedValue({ data: [catalogModel("cached")] });
    const cache = cacheWithRequestHandlers({ "model/list": listModels });
    await cache.metadataQueries.fetchModels();

    cache.scope.dispose();

    expect(cache.metadataQueries.metadataSnapshot("models")).toBeNull();
    await expect(cache.metadataQueries.fetchModels()).rejects.toThrow("Codex execution runtime is no longer active.");
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("fetches app-server metadata and models through their respective query records", async () => {
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [catalogModel("gpt-meta")] }),
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [catalogSkill("writer")] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [permissionProfile(":workspace")], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(64), rateLimitsByLimitId: null }),
    });

    await cache.metadataQueries.refreshAppServerMetadata();
    expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cache.metadataQueries.metadataSnapshot("permissionProfiles")?.map((profile) => profile.id)).toEqual([":workspace"]);
    expect(cache.metadataQueries.metadataSnapshot("rateLimits")?.primary?.usedPercent).toBe(64);
    expect(cache.metadataQueries.metadataDiagnosticsSnapshot().probes).toMatchObject({
      models: { status: "ok", checkedAt: expect.any(Number) },
      skills: { status: "ok", summary: "1 skills", checkedAt: expect.any(Number) },
      permissionProfiles: { status: "ok", summary: "1 profiles", checkedAt: expect.any(Number) },
      rateLimits: { status: "ok", summary: "available", checkedAt: expect.any(Number) },
    });
    expect(cache.metadataQueries.metadataSnapshot("models")?.map((model) => model.model)).toEqual(["gpt-meta"]);
  });

  it("publishes the authoritative hook catalog after a mutation", async () => {
    const hooksList = vi.fn().mockResolvedValue({
      data: [{ cwd: "/vault", hooks: [catalogHook({ trustStatus: "trusted" })], warnings: [], errors: [] }],
    });
    const write = vi.fn().mockResolvedValue({});
    const cache = cacheWithRequestHandlers({ "config/batchWrite": write, "hooks/list": hooksList });
    const listener = vi.fn();
    const unsubscribe = cache.metadataQueries.observeHooksResult(listener, { emitCurrent: false });

    const [untrustedHook] = hookItemsFromCatalogHooks([catalogHook({ trustStatus: "untrusted" })]);
    if (!untrustedHook) throw new Error("Expected hook fixture.");
    await cache.metadataQueries.trustHook(untrustedHook);

    expect(write).toHaveBeenCalledOnce();
    expect(hooksList).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({
      value: { hooks: [expect.objectContaining({ key: "hook-key", trustStatus: "trusted" })], warnings: [], errors: [] },
      error: null,
      isFetching: false,
    });
    unsubscribe();
  });

  it("publishes each metadata resource without waiting for unrelated refreshes", async () => {
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": vi.fn(() => skills.promise),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    const runtimeConfigListener = vi.fn();
    const modelsListener = vi.fn();
    const skillsListener = vi.fn();
    const unsubscribers = [
      cache.metadataQueries.observeMetadataResource("runtimeConfig", runtimeConfigListener, { emitCurrent: false }),
      cache.metadataQueries.observeMetadataResource("models", modelsListener, { emitCurrent: false }),
      cache.metadataQueries.observeMetadataResource("skills", skillsListener, { emitCurrent: false }),
    ];

    const refresh = cache.metadataQueries.refreshAppServerMetadata();
    await flushMicrotasks();
    expect(runtimeConfigListener).toHaveBeenCalledWith(expect.objectContaining({ id: "runtimeConfig", value: expect.any(Object) }));
    expect(modelsListener).toHaveBeenCalledWith(expect.objectContaining({ id: "models", value: [] }));
    expect(skillsListener).not.toHaveBeenCalled();

    skills.resolve({ data: [{ skills: [catalogSkill("writer")] }] });
    await refresh;

    expect(skillsListener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "skills", value: [expect.objectContaining({ name: "writer" })] }),
    );
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  it("keeps last-known-good metadata when background notification revalidation fails", async () => {
    const listSkills = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ skills: [catalogSkill("writer")] }] })
      .mockRejectedValueOnce(new Error("skills offline"));
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [catalogModel("unrelated")] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    const listener = vi.fn();
    const unsubscribe = cache.metadataQueries.observeMetadataResource("skills", listener, { emitCurrent: false });

    await cache.metadataQueries.refreshAppServerMetadata();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "writer" })],
      probe: expect.objectContaining({ id: "skills", status: "ok" }),
    });

    cache.metadataQueries.handleSkillsChanged();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));

    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "writer" })],
      probe: expect.objectContaining({ id: "skills", status: "failed" }),
    });
    unsubscribe();
  });

  it("publishes metadata resources after a later notification revalidation succeeds", async () => {
    const retry = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const nextRetry = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockRejectedValueOnce(new Error("skills offline"))
      .mockImplementationOnce(() => retry.promise)
      .mockImplementationOnce(() => nextRetry.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    await cache.metadataQueries.ensureAppServerMetadata();
    const listener = vi.fn();
    const unsubscribe = cache.metadataQueries.observeMetadataResource("skills", listener, { emitCurrent: false });

    cache.metadataQueries.handleSkillsChanged();
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    retry.resolve({ data: [{ skills: [catalogSkill("writer")] }] });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "writer" })],
      probe: expect.objectContaining({ id: "skills", status: "ok" }),
    });

    cache.metadataQueries.handleSkillsChanged();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledOnce();
    nextRetry.resolve({ data: [{ skills: [catalogSkill("editor")] }] });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "editor" })],
      probe: expect.objectContaining({ id: "skills", status: "ok" }),
    });
    unsubscribe();
  });

  it("deduplicates metadata resource RPCs across concurrent full refreshes", async () => {
    const config = deferred<Record<string, never>>();
    const models = deferred<{ data: CatalogModel[] }>();
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const profiles = deferred<{ data: RuntimePermissionProfileSummary[]; nextCursor: null }>();
    const limits = deferred<{ rateLimits: ReturnType<typeof appServerRateLimit>; rateLimitsByLimitId: null }>();
    const handlers = {
      "config/read": vi.fn(() => config.promise),
      "model/list": vi.fn(() => models.promise),
      "skills/list": vi.fn(() => skills.promise),
      "permissionProfile/list": vi.fn(() => profiles.promise),
      "account/rateLimits/read": vi.fn(() => limits.promise),
    };
    const cache = cacheWithRequestHandlers(handlers);

    const first = cache.metadataQueries.refreshAppServerMetadata();
    const second = cache.metadataQueries.refreshAppServerMetadata();
    await flushMicrotasks();

    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledOnce();
    config.resolve({});
    models.resolve({ data: [] });
    skills.resolve({ data: [{ skills: [] }] });
    profiles.resolve({ data: [], nextCursor: null });
    limits.resolve({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null });
    await Promise.all([first, second]);
  });

  it("revalidates an in-flight skills read after a context notification", async () => {
    const stale = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const fresh = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });

    const fullRefresh = cache.metadataQueries.ensureAppServerMetadata();
    await flushMicrotasks();
    cache.metadataQueries.handleSkillsChanged();
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: false });

    stale.resolve({ data: [{ skills: [catalogSkill("old")] }] });
    fresh.resolve({ data: [{ skills: [catalogSkill("new")] }] });
    await fullRefresh;
    await vi.waitFor(() => expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["new"]));
  });

  it("rejects an initial metadata refresh when runtime config fails after optional resources settle", async () => {
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockRejectedValue(new Error("config offline")),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": vi.fn(() => skills.promise),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    let settled = false;
    const refresh = cache.metadataQueries.refreshAppServerMetadata().finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    skills.resolve({ data: [{ skills: [] }] });
    await expect(refresh).rejects.toThrow("config offline");
    expect(cache.metadataQueries.metadataSnapshot("runtimeConfig")).toBeNull();
  });

  it("rejects runtime config refresh failures while preserving prior config and refreshed optional resources", async () => {
    const readConfig = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("config offline"));
    const listSkills = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ skills: [catalogSkill("old")] }] })
      .mockResolvedValueOnce({ data: [{ skills: [catalogSkill("new")] }] });
    const cache = cacheWithRequestHandlers({
      "config/read": readConfig,
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    await cache.metadataQueries.refreshAppServerMetadata();

    await expect(cache.metadataQueries.refreshAppServerMetadata()).rejects.toThrow("config offline");

    expect(cache.metadataQueries.metadataSnapshot("runtimeConfig")).not.toBeNull();
    expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["new"]);
  });

  it("shares in-flight model fetches between metadata and models queries", async () => {
    const modelRefresh = deferred<{ data: CatalogModel[] }>();
    const listModels = vi.fn(() => modelRefresh.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": listModels,
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });

    const metadataPromise = cache.metadataQueries.refreshAppServerMetadata();
    await flushMicrotasks();
    const modelsPromise = cache.metadataQueries.fetchModels();
    await flushMicrotasks();

    expect(listModels).toHaveBeenCalledOnce();

    modelRefresh.resolve({ data: [catalogModel("gpt-shared")] });

    await expect(modelsPromise).resolves.toMatchObject([{ model: "gpt-shared" }]);
    await expect(metadataPromise).resolves.toBeUndefined();
    expect(listModels).toHaveBeenCalledOnce();
    expect(cache.metadataQueries.metadataSnapshot("models")?.map((model) => model.model)).toEqual(["gpt-shared"]);
  });

  it("keeps every last-known-good resource through the full metadata refresh path", async () => {
    const listModels = vi
      .fn()
      .mockResolvedValueOnce({ data: [catalogModel("gpt-cached")] })
      .mockRejectedValueOnce(new Error("models offline"));
    const listSkills = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ skills: [catalogSkill("cached-skill")] }] })
      .mockRejectedValueOnce(new Error("skills offline"));
    const listProfiles = vi
      .fn()
      .mockResolvedValueOnce({ data: [permissionProfile(":cached")], nextCursor: null })
      .mockRejectedValueOnce(new Error("profiles offline"));
    const readRateLimits = vi
      .fn()
      .mockResolvedValueOnce({ rateLimits: appServerRateLimit(17), rateLimitsByLimitId: null })
      .mockRejectedValueOnce(new Error("limits offline"));
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": listModels,
      "skills/list": listSkills,
      "permissionProfile/list": listProfiles,
      "account/rateLimits/read": readRateLimits,
    });
    await cache.metadataQueries.refreshAppServerMetadata();

    await cache.metadataQueries.refreshAppServerMetadata();
    expect(cache.metadataQueries.metadataSnapshot("models")?.map((model) => model.model)).toEqual(["gpt-cached"]);
    expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["cached-skill"]);
    expect(cache.metadataQueries.metadataSnapshot("permissionProfiles")?.map((profile) => profile.id)).toEqual([":cached"]);
    expect(cache.metadataQueries.metadataSnapshot("rateLimits")?.primary?.usedPercent).toBe(17);
    expect(cache.metadataQueries.metadataDiagnosticsSnapshot().probes).toMatchObject({
      models: { status: "failed" },
      skills: { status: "failed", checkedAt: expect.any(Number) },
      permissionProfiles: { status: "failed", checkedAt: expect.any(Number) },
      rateLimits: { status: "failed", checkedAt: expect.any(Number) },
    });
  });
});

function cacheContext(overrides: Partial<AppServerExecutionContext> = {}): AppServerExecutionContext {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    ...overrides,
  };
}

function cacheWithThreads(
  fetchThreads: (context: AppServerExecutionContext, archived: boolean) => Promise<readonly ReturnType<typeof thread>[]>,
  context: AppServerExecutionContext = cacheContext(),
): TestQueryResources {
  const runtimeContext = { ...context };
  return createCache(
    {
      withClient: async (operation) => {
        return operation({
          request: async (method: string, params: { archived?: boolean; sectionId?: string }) => {
            if (method === "threadSection/list") return { data: [{ id: "pinned", name: "Pinned" }], nextCursor: null };
            if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
            if (params.sectionId === "pinned") return { data: [], nextCursor: null };
            return {
              data: await fetchThreads(runtimeContext, params.archived ?? false),
              nextCursor: null,
            };
          },
        } as never);
      },
    },
    context,
  );
}

function cacheWithRequestHandlers(
  handlers: Record<string, (params: unknown) => Promise<unknown>>,
  context: AppServerExecutionContext = cacheContext(),
  options: { exposePinnedFilters?: boolean } = {},
): TestQueryResources {
  const requestClient = {
    request: async (method: string, params: unknown) => {
      if (method === "threadSection/list") return { data: [{ id: "pinned", name: "Pinned" }], nextCursor: null };
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      if (method === "thread/list" && !options.exposePinnedFilters && params && typeof params === "object") {
        const threadListParams = params as Record<string, unknown>;
        if (threadListParams["sectionId"] === "pinned") return { data: [], nextCursor: null };
      }
      return handler(params);
    },
  };
  return createCache(
    {
      withClient: async (operation) => operation(requestClient as never),
    },
    context,
  );
}

interface TestQueryResources {
  readonly scope: AppServerQueryScope;
  readonly metadataQueries: AppServerMetadataQueries;
  readonly threadCatalog: AppServerThreadCatalog;
}

function createCache(clientAccess: AppServerClientAccess, context: AppServerExecutionContext = cacheContext()): TestQueryResources {
  const scope = new AppServerQueryScope(context, clientAccess);
  return {
    scope,
    metadataQueries: new AppServerMetadataQueries(scope),
    threadCatalog: new AppServerThreadCatalog(scope),
  };
}

function permissionProfile(id: string): RuntimePermissionProfileSummary {
  return { id, description: null, allowed: true };
}

function catalogModel(model: string): CatalogModel {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

function catalogSkill(name: string): CatalogSkillMetadata {
  return {
    name,
    description: "",
    path: `/tmp/${name}`,
    enabled: true,
  };
}

function catalogHook(
  overrides: Partial<Extract<CatalogHookMetadata, { handlerType: "command" }>> = {},
): Extract<CatalogHookMetadata, { handlerType: "command" }> {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "trusted",
    ...overrides,
  };
}

function appServerRateLimit(usedPercent: number): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    primary: { usedPercent, windowDurationMins: 300, resetsAt: null },
    secondary: null,
    individualLimit: null,
    rateLimitReachedType: null,
  };
}

function thread(id: string, archived = false): Thread {
  return {
    id,
    preview: "",
    name: null,
    archived,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" as const },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
