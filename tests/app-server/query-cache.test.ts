import { onlineManager } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import type { AppServerClientAccess } from "../../src/app-server/connection/client-access";
import type { AppServerExecutionContext } from "../../src/app-server/connection/execution-context";
import type { CatalogModel, CatalogSkillMetadata } from "../../src/app-server/protocol/catalog";
import { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { RateLimitSnapshot } from "../../src/domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../src/domain/runtime/permissions";
import type { Thread } from "../../src/domain/threads/model";
import { StaleExecutionRuntimeError } from "../../src/shared/runtime/execution-runtime-lifetime";

describe("AppServerQueryCache", () => {
  it("uses its required runtime-owned client access", async () => {
    const withClient = vi.fn(async (operation) =>
      operation({
        request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      } as never),
    );
    const cache = createCache({ withClient });

    await expect(cache.fetchActiveThreads()).resolves.toEqual([]);

    expect(withClient).toHaveBeenCalledOnce();
  });

  it("copies its execution context before performing requests", async () => {
    const context = { codexPath: "/opt/codex", vaultPath: "/vault-a" };
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const cache = new AppServerQueryCache(context, { withClient: async (operation) => operation({ request } as never) });

    context.codexPath = "/changed";
    context.vaultPath = "/vault-b";
    await cache.fetchActiveThreads();

    expect(request).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault-a",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("rejects new work after disposal", () => {
    const cache = createCache({
      withClient: vi.fn(() => Promise.resolve([])) as AppServerClientAccess["withClient"],
    });

    cache.dispose();
    cache.dispose();

    expect(() => cache.fetchModels()).toThrow(StaleExecutionRuntimeError);
  });

  it("classifies late completion after disposal as a stale execution runtime", async () => {
    const pending = deferred<readonly []>();
    const cache = createCache({
      withClient: vi.fn(() => pending.promise) as AppServerClientAccess["withClient"],
    });

    const fetch = cache.fetchModels();
    cache.dispose();
    pending.resolve([]);

    await expect(fetch).rejects.toBeInstanceOf(StaleExecutionRuntimeError);
  });

  it("tears down observers without notifying them after disposal", async () => {
    const pending = deferred<readonly []>();
    const cache = createCache({
      withClient: vi.fn(() => pending.promise) as AppServerClientAccess["withClient"],
    });
    const listener = vi.fn();
    cache.observeModelsResult(listener, { emitCurrent: false });

    const fetch = cache.fetchModels();
    listener.mockClear();
    cache.dispose();
    pending.resolve([]);
    await expect(fetch).rejects.toBeInstanceOf(StaleExecutionRuntimeError);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);

    await expect(cache.refreshActiveThreads()).resolves.toEqual([]);
    expect(cache.activeThreadsSnapshot()).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
  });

  it("preserves the last-known-good active thread list when a refresh fails", async () => {
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([thread("cached")])
      .mockRejectedValueOnce(new Error("offline"));
    const cache = cacheWithThreads(fetchThreads);
    await cache.refreshActiveThreads();

    await expect(cache.refreshActiveThreads()).rejects.toThrow("offline");

    expect(cache.activeThreadsSnapshot()).toEqual([thread("cached")]);
  });

  it("shares concurrent active thread refreshes within one resource identity", async () => {
    const pending = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi.fn(() => pending.promise);
    const cache = cacheWithThreads(fetchThreads);

    const first = cache.refreshActiveThreads();
    const second = cache.refreshActiveThreads();
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
    await cache.refreshActiveThreads();

    const first = cache.refreshActiveThreads();
    await flushMicrotasks();
    const second = cache.refreshActiveThreads();
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

    await expect(cache.refreshActiveThreads()).resolves.toEqual([thread("active")]);
    await expect(cache.refreshArchivedThreads()).resolves.toEqual([thread("archived", true)]);

    expect(cache.activeThreadsSnapshot()).toEqual([thread("active")]);
    expect(cache.archivedThreadsSnapshot()).toEqual([thread("archived", true)]);
    expect(fetchThreads).toHaveBeenNthCalledWith(1, cacheContext(), false);
    expect(fetchThreads).toHaveBeenNthCalledWith(2, cacheContext(), true);
  });

  it("loads active thread history one page at a time", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    await expect(cache.refreshActiveThreads()).resolves.toEqual([thread("first")]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
    expect(listThreads).toHaveBeenCalledOnce();

    await expect(cache.loadMoreActiveThreads()).resolves.toEqual([thread("first"), thread("second")]);
    expect(cache.hasMoreActiveThreads()).toBe(false);
    expect(cache.recentActiveThreadsSnapshot()).toEqual([thread("first")]);
    expect(listThreads).toHaveBeenNthCalledWith(2, {
      cwd: "/vault",
      cursor: "page-2",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
  });

  it("moves an opened older thread to the front without discarding loaded history", async () => {
    const recent = { ...thread("recent"), recencyAt: 20 };
    const older = { ...thread("older"), recencyAt: 10 };
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [recent], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [older], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();
    await cache.loadMoreActiveThreads();

    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "older", changes: { recencyAt: 30 } }]);

    expect(cache.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["older", "recent"]);
    expect(cache.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["older"]);
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it("keeps the recent window stable across event projections", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();
    await cache.loadMoreActiveThreads();

    cache.applyThreadListMutations([{ kind: "upsert", list: "active", thread: { ...thread("new"), recencyAt: 30 } }]);
    expect(cache.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["new"]);

    cache.applyThreadListMutations([
      { kind: "remove", list: "active", threadId: "new" },
      { kind: "remove", list: "active", threadId: "first" },
    ]);
    expect(cache.recentActiveThreadsSnapshot()?.map((item) => item.id)).toEqual(["second"]);
  });

  it("shares concurrent Load more requests through the InfiniteQuery", async () => {
    const nextPage = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockImplementationOnce(() => nextPage.promise);
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();

    const first = cache.loadMoreActiveThreads();
    const second = cache.loadMoreActiveThreads();
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
    await cache.refreshActiveThreads();

    const loadMore = cache.loadMoreActiveThreads();
    await flushMicrotasks();
    await cache.refreshActiveThreads();
    oldPage.resolve({ data: [thread("old-second")], nextCursor: null });

    await expect(loadMore).resolves.toEqual([thread("old-first")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("new-first")]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
  });

  it("does not append a load-more page invalidated by an exact event", async () => {
    const oldPage = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockImplementationOnce(() => oldPage.promise)
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();

    const loadMore = cache.loadMoreActiveThreads();
    await flushMicrotasks();
    cache.applyThreadListMutations([{ kind: "remove", list: "active", threadId: "deleted-on-page-2" }]);
    oldPage.resolve({ data: [thread("deleted-on-page-2")], nextCursor: null });

    await expect(loadMore).resolves.toEqual([thread("first")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("first")]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
  });

  it("projects an exact event without preserving a synthetic page boundary", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first"), thread("old-second")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("new-first"), thread("old-first")], nextCursor: "page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();

    cache.applyThreadListMutations([{ kind: "upsert", list: "active", thread: thread("new-first") }]);
    expect(cache.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["new-first", "old-first", "old-second"]);
    expect(listThreads).toHaveBeenCalledOnce();

    await cache.refreshActiveThreads();

    expect(cache.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["new-first", "old-first"]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
  });

  it("continues the existing cursor chain after an exact event", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("old-first")], nextCursor: "old-page-2" })
      .mockResolvedValueOnce({ data: [thread("old-second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    await cache.refreshActiveThreads();
    cache.applyThreadListMutations([{ kind: "upsert", list: "active", thread: thread("event-thread") }]);

    await expect(cache.loadMoreActiveThreads()).resolves.toEqual([thread("event-thread"), thread("old-first"), thread("old-second")]);

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
    await cache.refreshActiveThreads();
    await cache.loadMoreActiveThreads();

    cache.applyThreadListMutations([
      { kind: "upsert", list: "active", thread: { ...thread("second"), name: "Updated without re-ranking" } },
    ]);

    expect(cache.activeThreadsSnapshot()).toEqual([thread("first"), { ...thread("second"), name: "Updated without re-ranking" }]);
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
    await cache.refreshActiveThreads();

    const refresh = cache.refreshActiveThreads();
    await flushMicrotasks();
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "target", changes: { name: "from-event" } }]);

    expect(cache.activeThreadsSnapshot()?.[0]?.name).toBe("from-event");
    staleRead.resolve({ data: [{ ...thread("target"), name: "stale" }], nextCursor: null });
    await expect(refresh).resolves.toEqual([{ ...thread("target"), name: "from-event" }]);
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(3));

    expect(cache.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative");
  });

  it("restarts an initial thread read when an exact event arrives before any snapshot", async () => {
    const staleRead = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce({ data: [{ ...thread("target"), name: "authoritative" }], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const initial = cache.refreshActiveThreads();
    await flushMicrotasks();
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "target", changes: { name: "from-event" } }]);
    staleRead.resolve({ data: [{ ...thread("target"), name: "stale" }], nextCursor: null });

    await expect(initial).resolves.toEqual([{ ...thread("target"), name: "authoritative" }]);
    expect(cache.activeThreadsSnapshot()?.[0]?.name).toBe("authoritative");
    expect(listThreads).toHaveBeenCalledTimes(2);
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

    const initial = cache.refreshActiveThreads();
    await flushMicrotasks();
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "first-event", changes: { name: "first" } }]);
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "second-event", changes: { name: "second" } }]);

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
    await cache.refreshArchivedThreads();

    const refresh = cache.refreshArchivedThreads();
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.applyThreadListMutations([{ kind: "update", list: "archived", threadId: "cached", changes: { name: "from-event" } }]);

    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(3));
    await expect(refresh).resolves.toEqual([thread("authoritative", true)]);
    expect(cache.archivedThreadsSnapshot()).toEqual([thread("authoritative", true)]);
    staleRead.resolve({ data: [thread("stale", true)], nextCursor: null });
  });

  it("keeps a thread-picker inventory read out of the shared recent list", async () => {
    const oldInventory = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldInventory.promise)
      .mockResolvedValueOnce({ data: [thread("new-first")], nextCursor: "new-page-2" });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const inventory = cache.fetchActiveThreadSearchInventory();
    await flushMicrotasks();
    await cache.refreshActiveThreads();
    oldInventory.resolve({ data: [thread("old")], nextCursor: null });

    await expect(inventory).resolves.toEqual([thread("old")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("new-first")]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
  });

  it("refreshes the complete thread-picker inventory for each operation", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: null })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    await expect(cache.fetchActiveThreadSearchInventory()).resolves.toEqual([thread("first")]);
    await expect(cache.fetchActiveThreadSearchInventory()).resolves.toEqual([thread("second")]);

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

    const inventory = cache.fetchActiveThreadSearchInventory();
    await flushMicrotasks();
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "first-event", changes: { name: "first" } }]);
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "second-event", changes: { name: "second" } }]);

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
    await cache.fetchActiveThreadSearchInventory();

    const inventory = cache.fetchActiveThreadSearchInventory();
    await vi.waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    cache.applyThreadListMutations([{ kind: "update", list: "active", threadId: "event", changes: { name: "changed" } }]);

    await expect(inventory).resolves.toEqual([thread("authoritative")]);
    expect(listThreads).toHaveBeenCalledTimes(3);
    staleRead.resolve({ data: [thread("stale")], nextCursor: null });
  });

  it("runs local app-server queries independently of browser network state", async () => {
    const listModels = vi.fn().mockResolvedValue({ data: [catalogModel("local")] });
    const cache = cacheWithRequestHandlers({ "model/list": listModels });
    onlineManager.setOnline(false);

    try {
      await expect(cache.fetchModels()).resolves.toMatchObject([{ model: "local" }]);
      expect(listModels).toHaveBeenCalledOnce();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("clears snapshots and rejects new reads after disposal", async () => {
    const listModels = vi.fn().mockResolvedValue({ data: [catalogModel("cached")] });
    const cache = cacheWithRequestHandlers({ "model/list": listModels });
    await cache.fetchModels();

    cache.dispose();

    expect(cache.modelsSnapshot()).toBeNull();
    expect(() => cache.fetchModels()).toThrow(StaleExecutionRuntimeError);
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("freezes its lease context before starting requests", async () => {
    const context = { codexPath: "codex-captured", vaultPath: "/vault" };
    const capturedContext = { ...context };
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi.fn(() => refresh.promise);
    const cache = cacheWithThreads(fetchThreads, context);

    const promise = cache.refreshActiveThreads();
    context.codexPath = "codex-mutated";

    refresh.resolve([thread("captured")]);
    await expect(promise).resolves.toEqual([thread("captured")]);

    expect(fetchThreads).toHaveBeenCalledWith(capturedContext, false);
    expect(cache.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["captured"]);
  });

  it("fetches app-server metadata and models through their respective query records", async () => {
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [catalogModel("gpt-meta")] }),
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [catalogSkill("writer")] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [permissionProfile(":workspace")], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(64), rateLimitsByLimitId: null }),
    });

    await cache.refreshAppServerMetadata();
    const metadata = cache.appServerMetadataSnapshot();

    expect(metadata?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(metadata?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":workspace"]);
    expect(metadata?.rateLimit?.primary?.usedPercent).toBe(64);
    expect(metadata?.serverDiagnostics.probes.models.status).toBe("ok");
    expect(cache.modelsSnapshot()?.map((model) => model.model)).toEqual(["gpt-meta"]);
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
    const listener = vi.fn();
    const unsubscribe = cache.observeAppServerMetadataResources(listener, { emitCurrent: false });

    const refresh = cache.refreshAppServerMetadata();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "runtimeConfig", value: expect.any(Object) }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "models", value: [] }));
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ id: "skills", value: expect.any(Array) }));

    skills.resolve({ data: [{ skills: [catalogSkill("writer")] }] });
    await refresh;

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "skills", value: [expect.objectContaining({ name: "writer" })] }));
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
    await expect(cache.refreshSkills()).rejects.toThrow("skills offline");
    const listener = vi.fn();
    const unsubscribe = cache.observeAppServerMetadataResources(listener, { emitCurrent: false });

    const refresh = cache.refreshSkills();
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

    const nextRefresh = cache.refreshSkills();
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

    const first = cache.refreshAppServerMetadata();
    const second = cache.refreshAppServerMetadata();
    await flushMicrotasks();

    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledOnce();
    config.resolve({});
    models.resolve({ data: [] });
    skills.resolve({ data: [{ skills: [] }] });
    profiles.resolve({ data: [], nextCursor: null });
    limits.resolve({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null });
    await Promise.all([first, second]);
  });

  it("uses the regular skills query when a notification overlaps a full refresh", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const second = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": listSkills,
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });

    const fullRefresh = cache.refreshAppServerMetadata();
    await flushMicrotasks();
    const notificationRefresh = cache.refreshSkills();
    first.resolve({ data: [{ skills: [catalogSkill("old")] }] });
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: false });
    second.resolve({ data: [{ skills: [catalogSkill("new")] }] });
    await Promise.all([fullRefresh, notificationRefresh]);
    expect(cache.appServerMetadataSnapshot()?.availableSkills.map((skill) => skill.name)).toEqual(["new"]);
  });

  it("does not surface cancellation when a newer skills notification replaces an older refresh", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: [{ skills: [catalogSkill("latest")] }] });
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });
    const listener = vi.fn();
    const unsubscribe = cache.observeAppServerMetadataResources(listener, { emitCurrent: false });

    const older = cache.refreshSkills();
    await flushMicrotasks();
    const newer = cache.refreshSkills();
    first.resolve({ data: [{ skills: [catalogSkill("stale")] }] });

    await expect(Promise.all([older, newer])).resolves.toEqual([undefined, undefined]);
    expect(listener).toHaveBeenLastCalledWith({
      id: "skills",
      value: [expect.objectContaining({ name: "latest" })],
      probe: expect.objectContaining({ status: "ok" }),
    });
    expect(listSkills).toHaveBeenCalledTimes(2);
    unsubscribe();
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
    const refresh = cache.refreshAppServerMetadata().finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    skills.resolve({ data: [{ skills: [] }] });
    await expect(refresh).rejects.toThrow("config offline");
    expect(cache.appServerMetadataSnapshot()).toBeNull();
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
    await cache.refreshAppServerMetadata();

    await expect(cache.refreshAppServerMetadata()).rejects.toThrow("config offline");

    const snapshot = cache.appServerMetadataSnapshot();
    expect(snapshot?.runtimeConfig).not.toBeNull();
    expect(snapshot?.availableSkills.map((skill) => skill.name)).toEqual(["new"]);
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

    const metadataPromise = cache.refreshAppServerMetadata();
    await flushMicrotasks();
    const modelsPromise = cache.fetchModels();
    await flushMicrotasks();

    expect(listModels).toHaveBeenCalledOnce();

    modelRefresh.resolve({ data: [catalogModel("gpt-shared")] });

    await expect(modelsPromise).resolves.toMatchObject([{ model: "gpt-shared" }]);
    await expect(metadataPromise).resolves.toBeUndefined();
    expect(listModels).toHaveBeenCalledOnce();
    expect(cache.modelsSnapshot()?.map((model) => model.model)).toEqual(["gpt-shared"]);
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
    await cache.fetchModels();

    await cache.refreshAppServerMetadata();
    const metadataSnapshot = cache.appServerMetadataSnapshot();

    expect(metadataSnapshot?.serverDiagnostics.probes.models.status).toBe("failed");
    expect(cache.modelsSnapshot()?.map((model) => model.model)).toEqual(["gpt-cached"]);
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
    await cache.refreshAppServerMetadata();

    await cache.refreshAppServerMetadata();
    const refreshed = cache.appServerMetadataSnapshot();

    expect(cache.modelsSnapshot()?.map((model) => model.model)).toEqual(["gpt-cached"]);
    expect(refreshed?.availableSkills.map((skill) => skill.name)).toEqual(["cached-skill"]);
    expect(refreshed?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":cached"]);
    expect(refreshed?.rateLimit?.primary?.usedPercent).toBe(17);
    expect(refreshed?.serverDiagnostics.probes).toMatchObject({
      models: { status: "failed" },
      skills: { status: "failed" },
      permissionProfiles: { status: "failed" },
      rateLimits: { status: "failed" },
    });
    expect(cache.appServerMetadataSnapshot()).toEqual(refreshed);
  });

  it("stores an in-flight app-server snapshot as raw thread-list truth", async () => {
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const cache = cacheWithThreads(() => refresh.promise);

    const promise = cache.refreshActiveThreads();
    await flushMicrotasks();

    refresh.resolve([thread("thread"), thread("other")]);

    await expect(promise).resolves.toEqual([thread("thread"), thread("other")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("thread"), thread("other")]);
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
): AppServerQueryCache {
  const runtimeContext = { ...context };
  return new AppServerQueryCache(context, {
    withClient: async (operation) => {
      return operation({
        request: async (method: string, params: { archived?: boolean }) => {
          if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
          return {
            data: await fetchThreads(runtimeContext, params.archived ?? false),
            nextCursor: null,
          };
        },
      } as never);
    },
  });
}

function cacheWithRequestHandlers(
  handlers: Record<string, (params: unknown) => Promise<unknown>>,
  context: AppServerExecutionContext = cacheContext(),
): AppServerQueryCache {
  const requestClient = {
    request: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params);
    },
  };
  return new AppServerQueryCache(context, {
    withClient: async (operation) => operation(requestClient as never),
  });
}

function createCache(clientAccess: AppServerClientAccess): AppServerQueryCache {
  return new AppServerQueryCache(cacheContext(), clientAccess);
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
