import { onlineManager, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import type { AppServerClientAccess } from "../../../src/app-server/connection/client-access";
import type { AppServerExecutionContext } from "../../../src/app-server/connection/execution-context";
import type { CatalogModel, CatalogSkillMetadata } from "../../../src/app-server/protocol/catalog";
import { AppServerMetadataQueries } from "../../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../../src/app-server/query/query-scope";
import { AppServerThreadCatalog } from "../../../src/app-server/query/thread-catalog-queries";
import type { RateLimitSnapshot } from "../../../src/domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../../src/domain/runtime/permissions";
import type { Thread } from "../../../src/domain/threads/model";

describe("app-server query resources", () => {
  it("uses its required runtime-owned client access", async () => {
    const withClient = vi.fn(async (operation) =>
      operation({
        request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      } as never),
    );
    const cache = createCache({ withClient });

    await expect(cache.threadCatalog.fetchActiveThreads()).resolves.toEqual([]);

    expect(withClient).toHaveBeenCalledOnce();
  });

  it("copies its execution context before performing requests", async () => {
    const context = { codexPath: "/opt/codex", vaultPath: "/vault-a" };
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const cache = createCache({ withClient: async (operation) => operation({ request } as never) }, context);

    context.codexPath = "/changed";
    context.vaultPath = "/vault-b";
    await cache.threadCatalog.fetchActiveThreads();

    expect(request).toHaveBeenNthCalledWith(1, "thread/list", {
      cwd: "/vault-a",
      archived: false,
      isPinned: true,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    expect(request).toHaveBeenNthCalledWith(2, "thread/list", {
      cwd: "/vault-a",
      archived: false,
      isPinned: false,
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
    cache.metadataQueries.observeModelsResult(listener, { emitCurrent: false });

    const fetch = cache.metadataQueries.fetchModels();
    listener.mockClear();
    cache.scope.dispose();
    pending.resolve([]);
    await fetch.catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });

  it("tears down an observer when its initial notification disposes the query scope", () => {
    const cache = createCache({
      withClient: vi.fn(() => Promise.resolve([])) as AppServerClientAccess["withClient"],
    });
    const destroy = vi.spyOn(QueryObserver.prototype, "destroy");

    const unsubscribe = cache.metadataQueries.observeModelsResult(() => {
      cache.scope.dispose();
    });

    const destroyCountAfterDisposal = destroy.mock.calls.length;
    expect(destroyCountAfterDisposal).toBeGreaterThan(0);
    unsubscribe();
    expect(destroy).toHaveBeenCalledTimes(destroyCountAfterDisposal);
    destroy.mockRestore();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);

    await expect(cache.threadCatalog.refreshActiveThreads()).resolves.toEqual([]);
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
  });

  it("preserves the last-known-good active thread list when a refresh fails", async () => {
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([thread("cached")])
      .mockRejectedValueOnce(new Error("offline"));
    const cache = cacheWithThreads(fetchThreads);
    await cache.threadCatalog.refreshActiveThreads();

    await expect(cache.threadCatalog.refreshActiveThreads()).rejects.toThrow("offline");

    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("cached")]);
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
    await expect(Promise.all([first, second])).resolves.toEqual([[thread("shared")], [thread("shared")]]);
  });

  it("joins a refresh that starts after an existing refresh has begun", async () => {
    const pending = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([thread("cached")])
      .mockImplementationOnce(() => pending.promise);
    const cache = cacheWithThreads(fetchThreads);
    await cache.threadCatalog.refreshActiveThreads();

    const first = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();
    const second = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();

    expect(fetchThreads).toHaveBeenCalledTimes(2);
    pending.resolve([thread("fresh")]);
    await expect(Promise.all([first, second])).resolves.toEqual([[thread("fresh")], [thread("fresh")]]);
  });

  it("keeps active and archived thread list snapshots separate", async () => {
    const fetchThreads = vi.fn((_context: AppServerExecutionContext, archived: boolean) =>
      Promise.resolve(archived ? [thread("archived", true)] : [thread("active")]),
    );
    const cache = cacheWithThreads(fetchThreads);

    await expect(cache.threadCatalog.refreshActiveThreads()).resolves.toEqual([thread("active")]);
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

    await expect(cache.threadCatalog.refreshActiveThreads()).resolves.toEqual([thread("first")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(true);
    expect(listThreads).toHaveBeenCalledOnce();

    await expect(cache.threadCatalog.loadMoreActiveThreads()).resolves.toEqual([thread("first"), thread("second")]);
    expect(cache.threadCatalog.hasMoreActiveThreads()).toBe(false);
    expect(cache.threadCatalog.recentActiveThreadsSnapshot()).toEqual([thread("first")]);
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
      const request = params as { isPinned?: boolean; cursor?: string };
      if (request.isPinned === true) {
        return request.cursor === "pinned-page-2"
          ? Promise.resolve({ data: [{ ...thread("older-pinned"), isPinned: true }], nextCursor: null })
          : Promise.resolve({ data: [{ ...thread("pinned"), isPinned: true }], nextCursor: "pinned-page-2" });
      }
      if (request.cursor === "page-2") return Promise.resolve({ data: [thread("older")], nextCursor: null });
      return Promise.resolve({ data: [thread("recent")], nextCursor: "page-2" });
    });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads }, cacheContext(), { exposePinnedFilters: true });

    await expect(cache.threadCatalog.refreshActiveThreads()).resolves.toMatchObject([
      { id: "pinned", isPinned: true },
      { id: "older-pinned", isPinned: true },
      { id: "recent" },
    ]);
    await expect(cache.threadCatalog.loadMoreActiveThreads()).resolves.toMatchObject([
      { id: "pinned", isPinned: true },
      { id: "older-pinned", isPinned: true },
      { id: "recent" },
      { id: "older" },
    ]);
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ isPinned: true }));
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ isPinned: true, cursor: "pinned-page-2" }));
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ isPinned: false }));
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ isPinned: false, cursor: "page-2" }));
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

  it("does not republish a semantically identical lifecycle fact", async () => {
    const existing = thread("thread");
    const cache = cacheWithRequestHandlers({
      "thread/list": vi.fn().mockResolvedValue({ data: [existing], nextCursor: null }),
    });
    await cache.threadCatalog.refreshActiveThreads();
    const listener = vi.fn();
    const unsubscribe = cache.threadCatalog.observeActiveThreadsResult(listener, { emitCurrent: false });

    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: existing }]);
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
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
    await expect(Promise.all([first, second])).resolves.toEqual([
      [thread("first"), thread("second")],
      [thread("first"), thread("second")],
    ]);
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

    await expect(loadMore).resolves.toEqual([thread("old-first")]);
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

    await expect(loadMore).resolves.toEqual([thread("first")]);
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

  it("continues the existing cursor chain after an exact event", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first")], nextCursor: "old-page-2" })
      .mockResolvedValueOnce({ data: [thread("old-second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshActiveThreads();
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "upsert", list: "active", thread: thread("event-thread") }]);

    await expect(cache.threadCatalog.loadMoreActiveThreads()).resolves.toEqual([
      thread("event-thread"),
      thread("old-first"),
      thread("old-second"),
    ]);

    expect(listThreads).toHaveBeenNthCalledWith(2, {
      cwd: "/vault",
      cursor: "old-page-2",
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

  it("cancels a stale thread read before applying an exact event", async () => {
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
    await expect(refresh).resolves.toEqual([{ ...thread("target"), name: "from-event" }]);
    await vi.waitFor(() => expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative"));
  });

  it("restarts an initial thread read when an exact event arrives before any snapshot", async () => {
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

    await expect(initial).resolves.toEqual([{ ...thread("target"), name: "authoritative" }]);
    expect(cache.threadCatalog.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative");
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

  it("rejoins the active thread query through repeated event cancellations", async () => {
    const firstRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const secondRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise)
      .mockResolvedValueOnce({ data: [thread("authoritative")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const initial = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "first-event", changes: { name: "first" } },
    ]);
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "second-event", changes: { name: "second" } },
    ]);

    await expect(initial).resolves.toEqual([thread("authoritative")]);
    expect(listThreads).toHaveBeenCalledTimes(3);
    firstRead.resolve({ data: [thread("obsolete-first")], nextCursor: null });
    secondRead.resolve({ data: [thread("obsolete-second")], nextCursor: null });
  });

  it("rejoins an archived thread refresh cancelled by an exact event", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("cached", true)], nextCursor: null })
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({ data: [thread("authoritative", true)], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.refreshArchivedThreads();

    const refresh = cache.threadCatalog.refreshArchivedThreads();
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "archived", threadId: "cached", changes: { name: "from-event" } },
    ]);

    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(3));
    await expect(refresh).resolves.toEqual([thread("authoritative", true)]);
    expect(cache.threadCatalog.archivedThreadsSnapshot()).toEqual([thread("authoritative", true)]);
    staleRead.resolve({ data: [thread("stale", true)], nextCursor: null });
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

  it("rejoins the complete thread-picker inventory through repeated event cancellations", async () => {
    const firstRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const secondRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise)
      .mockResolvedValueOnce({ data: [thread("authoritative")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const inventory = cache.threadCatalog.fetchActiveThreadSearchInventory();
    await flushMicrotasks();
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "first-event", changes: { name: "first" } },
    ]);
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.threadCatalog.applyThreadCatalogChanges([
      { kind: "update", list: "active", threadId: "second-event", changes: { name: "second" } },
    ]);

    await expect(inventory).resolves.toEqual([thread("authoritative")]);
    expect(listThreads).toHaveBeenCalledTimes(3);
    firstRead.resolve({ data: [thread("obsolete-first")], nextCursor: null });
    secondRead.resolve({ data: [thread("obsolete-second")], nextCursor: null });
  });

  it("does not reuse a cached complete inventory after an event cancels its refresh", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("cached")], nextCursor: null })
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({ data: [thread("authoritative")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.threadCatalog.fetchActiveThreadSearchInventory();

    const inventory = cache.threadCatalog.fetchActiveThreadSearchInventory();
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.threadCatalog.applyThreadCatalogChanges([{ kind: "update", list: "active", threadId: "event", changes: { name: "changed" } }]);

    await expect(inventory).resolves.toEqual([thread("authoritative")]);
    expect(listThreads).toHaveBeenCalledTimes(3);
    staleRead.resolve({ data: [thread("stale")], nextCursor: null });
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

  it("freezes its lease context before starting requests", async () => {
    const context = { codexPath: "codex-captured", vaultPath: "/vault" };
    const capturedContext = { ...context };
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi.fn(() => refresh.promise);
    const cache = cacheWithThreads(fetchThreads, context);

    const promise = cache.threadCatalog.refreshActiveThreads();
    context.codexPath = "codex-mutated";

    refresh.resolve([thread("captured")]);
    await expect(promise).resolves.toEqual([thread("captured")]);

    expect(fetchThreads).toHaveBeenCalledWith(capturedContext, false);
    expect(cache.threadCatalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["captured"]);
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
    expect(cache.metadataQueries.metadataDiagnosticsSnapshot().probes.models.status).toBe("ok");
    expect(cache.metadataQueries.metadataSnapshot("models")?.map((model) => model.model)).toEqual(["gpt-meta"]);
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

  it("lets display consumers observe one metadata resource without subscribing to unrelated records", async () => {
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

    await expect(cache.metadataQueries.refreshSkills()).rejects.toThrow("skills offline");

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "writer" })],
      probe: expect.objectContaining({ id: "skills", status: "failed" }),
    });
    unsubscribe();
  });

  it("publishes metadata resources only after a successful retry settles", async () => {
    const retry = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const nextRetry = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockRejectedValueOnce(new Error("skills offline"))
      .mockImplementationOnce(() => retry.promise)
      .mockImplementationOnce(() => nextRetry.promise);
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });
    await expect(cache.metadataQueries.refreshSkills()).rejects.toThrow("skills offline");
    const listener = vi.fn();
    const unsubscribe = cache.metadataQueries.observeMetadataResource("skills", listener, { emitCurrent: false });

    const refresh = cache.metadataQueries.refreshSkills();
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    retry.resolve({ data: [{ skills: [catalogSkill("writer")] }] });
    await refresh;

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "writer" })],
      probe: expect.objectContaining({ id: "skills", status: "ok" }),
    });

    const nextRefresh = cache.metadataQueries.refreshSkills();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledOnce();
    nextRetry.resolve({ data: [{ skills: [catalogSkill("editor")] }] });
    await nextRefresh;

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

  it("refreshes skills after a notification invalidates an in-flight full refresh", async () => {
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

    const fullRefresh = cache.metadataQueries.refreshAppServerMetadata();
    await flushMicrotasks();
    const notificationRefresh = cache.metadataQueries.refreshSkills();
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: true });

    stale.resolve({ data: [{ skills: [catalogSkill("old")] }] });
    fresh.resolve({ data: [{ skills: [catalogSkill("new")] }] });
    await Promise.all([fullRefresh, notificationRefresh]);
    expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["new"]);
  });

  it("keeps a full refresh from overtaking a skills notification refresh", async () => {
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi.fn(() => skills.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });

    const notificationRefresh = cache.metadataQueries.refreshSkills();
    const fullRefresh = cache.metadataQueries.refreshAppServerMetadata();
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledOnce());
    expect(listSkills).toHaveBeenCalledWith({ cwds: ["/vault"], forceReload: true });
    skills.resolve({ data: [{ skills: [catalogSkill("new")] }] });

    await Promise.all([notificationRefresh, fullRefresh]);
    expect(listSkills).toHaveBeenCalledOnce();
    expect(cache.metadataQueries.metadataSnapshot("skills")?.map((skill) => skill.name)).toEqual(["new"]);
  });

  it("coalesces repeated skills notifications into a trailing refresh", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const second = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });
    const listener = vi.fn();
    const unsubscribe = cache.metadataQueries.observeMetadataResource("skills", listener, { emitCurrent: false });

    const older = cache.metadataQueries.refreshSkills();
    await flushMicrotasks();
    const newer = cache.metadataQueries.refreshSkills();
    first.resolve({ data: [{ skills: [catalogSkill("stale")] }] });
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    second.resolve({ data: [{ skills: [catalogSkill("latest")] }] });

    await expect(Promise.all([older, newer])).resolves.toEqual([undefined, undefined]);
    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "latest" })],
      probe: expect.objectContaining({ status: "ok" }),
    });
    expect(listSkills).toHaveBeenNthCalledWith(1, { cwds: ["/vault"], forceReload: true });
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: true });
    unsubscribe();
  });

  it("refreshes rate limits after a notification invalidates an in-flight full refresh", async () => {
    const stale = deferred<{ rateLimits: RateLimitSnapshot; rateLimitsByLimitId: null }>();
    const fresh = deferred<{ rateLimits: RateLimitSnapshot; rateLimitsByLimitId: null }>();
    const readRateLimits = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": readRateLimits,
    });

    const fullRefresh = cache.metadataQueries.refreshAppServerMetadata();
    await flushMicrotasks();
    const notificationRefresh = cache.metadataQueries.refreshRateLimits();
    await vi.waitFor(() => expect(readRateLimits).toHaveBeenCalledTimes(2));

    stale.resolve({ rateLimits: appServerRateLimit(17), rateLimitsByLimitId: null });
    fresh.resolve({ rateLimits: appServerRateLimit(64), rateLimitsByLimitId: null });
    await Promise.all([fullRefresh, notificationRefresh]);

    expect(cache.metadataQueries.metadataSnapshot("rateLimits")?.primary?.usedPercent).toBe(64);
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

  it("keeps query-cached models when app-server metadata model refresh fails", async () => {
    const listModels = vi
      .fn()
      .mockResolvedValueOnce({ data: [catalogModel("gpt-cached")] })
      .mockRejectedValueOnce(new Error("offline"));
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": listModels,
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    await cache.metadataQueries.fetchModels();

    await cache.metadataQueries.refreshAppServerMetadata();
    expect(cache.metadataQueries.metadataDiagnosticsSnapshot().probes.models.status).toBe("failed");
    expect(cache.metadataQueries.metadataSnapshot("models")?.map((model) => model.model)).toEqual(["gpt-cached"]);
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
      skills: { status: "failed" },
      permissionProfiles: { status: "failed" },
      rateLimits: { status: "failed" },
    });
  });

  it("stores an in-flight app-server snapshot as raw thread-list truth", async () => {
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const cache = cacheWithThreads(() => refresh.promise);

    const promise = cache.threadCatalog.refreshActiveThreads();
    await flushMicrotasks();

    refresh.resolve([thread("thread"), thread("other")]);

    await expect(promise).resolves.toEqual([thread("thread"), thread("other")]);
    expect(cache.threadCatalog.activeThreadsSnapshot()).toEqual([thread("thread"), thread("other")]);
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
          request: async (method: string, params: { archived?: boolean; isPinned?: boolean }) => {
            if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
            if ("isPinned" in params && params.isPinned === true) return { data: [], nextCursor: null };
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
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      if (method === "thread/list" && !options.exposePinnedFilters && params && typeof params === "object") {
        const threadListParams = params as Record<string, unknown>;
        if (threadListParams["isPinned"] === true) return { data: [], nextCursor: null };
        if (threadListParams["isPinned"] === false) {
          const { isPinned: _, ...legacyParams } = threadListParams;
          return handler(legacyParams);
        }
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
    canAcceptDirectInput: null,
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
