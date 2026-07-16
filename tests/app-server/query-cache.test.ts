import { describe, expect, it, vi } from "vitest";
import type { CatalogModel, CatalogSkillMetadata } from "../../src/app-server/protocol/catalog";
import { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { AppServerQueryContext, AppServerQueryContextIdentity } from "../../src/app-server/query/keys";
import type { RateLimitSnapshot } from "../../src/domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../src/domain/runtime/permissions";

describe("AppServerQueryCache", () => {
  it("garbage-collects inactive query records", async () => {
    vi.useFakeTimers();
    try {
      const cache = cacheWithThreads(() => Promise.resolve([thread("temporary")]));
      await cache.fetchActiveThreads();

      await vi.advanceTimersByTimeAsync(300_001);

      expect(cache.activeThreadsSnapshot()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not share or store snapshots before the cache context is complete", async () => {
    const context = cacheContext({ codexPath: "" });
    const cache = new AppServerQueryCache(context);

    await expect(cache.fetchActiveThreads()).resolves.toEqual([]);
    expect(cache.activeThreadsSnapshot()).toBeNull();
    expect(cache.appServerMetadataSnapshot()).toBeNull();
    expect(cache.modelsSnapshot()).toBeNull();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);

    await expect(cache.refreshActiveThreads()).resolves.toEqual([]);
    expect(cache.activeThreadsSnapshot()).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
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

  it("keeps active and archived thread list snapshots separate", async () => {
    const fetchThreads = vi.fn((_context: AppServerQueryContext, archived: boolean) =>
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
    expect(listThreads).toHaveBeenNthCalledWith(2, {
      cwd: "/vault",
      cursor: "page-2",
      archived: false,
      limit: 100,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
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
    await Promise.resolve();
    await cache.refreshActiveThreads();
    oldPage.resolve({ data: [thread("old-second")], nextCursor: null });

    await expect(loadMore).resolves.toEqual([thread("new-first")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("new-first")]);
    expect(cache.hasMoreActiveThreads()).toBe(true);
  });

  it("retries a full active-thread inventory when a first-page refresh wins the race", async () => {
    const oldInventory = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldInventory.promise)
      .mockResolvedValueOnce({ data: [thread("new-first")], nextCursor: "new-page-2" })
      .mockResolvedValueOnce({ data: [thread("new-first"), thread("new-second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const inventory = cache.fetchAllActiveThreads();
    await flushMicrotasks();
    await cache.refreshActiveThreads();
    oldInventory.resolve({ data: [thread("old")], nextCursor: null });

    await expect(inventory).resolves.toEqual([thread("new-first"), thread("new-second")]);
    expect(cache.activeThreadsSnapshot()).toEqual([thread("new-first"), thread("new-second")]);
  });

  it("does not revive a disposed cache when an active-thread inventory resolves", async () => {
    const inventory = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi.fn(() => inventory.promise);
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });

    const fetch = cache.fetchAllActiveThreads();
    await flushMicrotasks();
    cache.dispose();
    inventory.resolve({ data: [thread("stale")], nextCursor: null });

    await expect(fetch).rejects.toThrow("query cache was disposed");
    expect(cache.activeThreadsSnapshot()).toBeNull();
    expect(listThreads).toHaveBeenCalledOnce();
  });

  it("rejects a cached result when disposal wins before its continuation", async () => {
    const listModels = vi.fn().mockResolvedValue({ data: [catalogModel("cached")] });
    const cache = cacheWithRequestHandlers({ "model/list": listModels });
    await cache.fetchModels();

    const cached = cache.fetchModels();
    cache.dispose();

    await expect(cached).rejects.toThrow("query cache was disposed");
    expect(cache.modelsSnapshot()).toBeNull();
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("freezes its lease context before starting requests", async () => {
    const context = cacheContext({ codexPath: "codex-captured" });
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

    const metadata = await cache.refreshAppServerMetadata();

    expect(metadata?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(metadata?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":workspace"]);
    expect(metadata?.rateLimit?.primary?.usedPercent).toBe(64);
    expect(metadata?.serverDiagnostics.probes.models.status).toBe("ok");
    expect(cache.modelsSnapshot()?.map((model) => model.model)).toEqual(["gpt-meta"]);
  });

  it("publishes one derived metadata projection after a coordinated refresh", async () => {
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": vi.fn(() => skills.promise),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    const listener = vi.fn();
    const unsubscribe = cache.observeAppServerMetadataResult(listener, { emitCurrent: false });

    const refresh = cache.refreshAppServerMetadata();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    skills.resolve({ data: [{ skills: [catalogSkill("writer")] }] });
    await refresh;
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ availableSkills: [expect.objectContaining({ name: "writer" })] }) }),
    );
    unsubscribe();
  });

  it("coalesces a burst of skills notifications into one forced trailing refresh", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const second = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });

    const refreshes = Array.from({ length: 10 }, () => cache.refreshSkills());
    await flushMicrotasks();
    expect(listSkills).toHaveBeenCalledOnce();
    expect(listSkills).toHaveBeenNthCalledWith(1, { cwds: ["/vault"], forceReload: true });

    first.resolve({ data: [{ skills: [catalogSkill("old")] }] });
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: true });
    second.resolve({ data: [{ skills: [catalogSkill("new")] }] });
    await Promise.all(refreshes);
    expect(listSkills).toHaveBeenCalledTimes(2);
  });

  it("coalesces a burst of rate-limit notifications into one trailing refresh", async () => {
    const first = deferred<{ rateLimits: ReturnType<typeof appServerRateLimit>; rateLimitsByLimitId: null }>();
    const second = deferred<{ rateLimits: ReturnType<typeof appServerRateLimit>; rateLimitsByLimitId: null }>();
    const readRateLimits = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const cache = cacheWithRequestHandlers({ "account/rateLimits/read": readRateLimits });

    const refreshes = Array.from({ length: 10 }, () => cache.refreshRateLimits());
    await flushMicrotasks();
    expect(readRateLimits).toHaveBeenCalledOnce();

    first.resolve({ rateLimits: appServerRateLimit(10), rateLimitsByLimitId: null });
    await vi.waitFor(() => expect(readRateLimits).toHaveBeenCalledTimes(2));
    second.resolve({ rateLimits: appServerRateLimit(20), rateLimitsByLimitId: null });
    await Promise.all(refreshes);
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

  it("runs a forced skills request after a notification overlaps a full refresh", async () => {
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
    expect(listSkills).toHaveBeenNthCalledWith(2, { cwds: ["/vault"], forceReload: true });
    second.resolve({ data: [{ skills: [catalogSkill("new")] }] });
    await Promise.all([fullRefresh, notificationRefresh]);
    expect(cache.appServerMetadataSnapshot()?.availableSkills.map((skill) => skill.name)).toEqual(["new"]);
  });

  it("schedules one more skills read when a notification arrives during the trailing refresh", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const second = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const third = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });

    const leading = cache.refreshSkills();
    const trailing = cache.refreshSkills();
    first.resolve({ data: [{ skills: [catalogSkill("first")] }] });
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2));
    const afterTrailing = cache.refreshSkills();
    second.resolve({ data: [{ skills: [catalogSkill("second")] }] });
    await vi.waitFor(() => expect(listSkills).toHaveBeenCalledTimes(3));
    third.resolve({ data: [{ skills: [catalogSkill("third")] }] });

    await Promise.all([leading, trailing, afterTrailing]);
    expect(listSkills).toHaveBeenCalledTimes(3);
  });

  it("does not start trailing notification work after the cache is disposed", async () => {
    const first = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi.fn(() => first.promise);
    const cache = cacheWithRequestHandlers({ "skills/list": listSkills });

    const leading = cache.refreshSkills();
    const trailing = cache.refreshSkills();
    await flushMicrotasks();
    cache.dispose();
    first.resolve({ data: [{ skills: [catalogSkill("stale")] }] });
    await expect(Promise.all([leading, trailing])).rejects.toThrow("query cache was disposed");
    await flushMicrotasks();

    expect(listSkills).toHaveBeenCalledOnce();
    expect(cache.appServerMetadataSnapshot()).toBeNull();
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

  it("does not emit a queued metadata projection after unsubscribe", async () => {
    vi.useFakeTimers({ toFake: ["queueMicrotask"] });
    try {
      const cache = metadataCacheWithSuccessfulHandlers();
      await cache.refreshAppServerMetadata();
      const listener = vi.fn();
      const unsubscribe = cache.observeAppServerMetadataResult(listener, { emitCurrent: false });

      await cache.refreshSkills();
      unsubscribe();
      vi.runAllTicks();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit a queued metadata projection after the cache is cleared", async () => {
    vi.useFakeTimers({ toFake: ["queueMicrotask"] });
    try {
      const cache = metadataCacheWithSuccessfulHandlers();
      await cache.refreshAppServerMetadata();
      const listener = vi.fn();
      cache.observeAppServerMetadataResult(listener, { emitCurrent: false });

      await cache.refreshSkills();
      cache.dispose();
      vi.runAllTicks();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    await expect(metadataPromise).resolves.toMatchObject({ serverDiagnostics: { probes: { models: { status: "ok" } } } });
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

    const metadataSnapshot = await cache.refreshAppServerMetadata();

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

    const refreshed = await cache.refreshAppServerMetadata();

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

function cacheContext(overrides: Partial<AppServerQueryContextIdentity> = {}): AppServerQueryContextIdentity {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    generation: 1,
    ...overrides,
  };
}

function cacheWithThreads(
  fetchThreads: (context: AppServerQueryContextIdentity, archived: boolean) => Promise<readonly ReturnType<typeof thread>[]>,
  context: AppServerQueryContextIdentity = cacheContext(),
): AppServerQueryCache {
  return new AppServerQueryCache(context, {
    clientRunner: {
      runWithClient: async (context, operation) => {
        return operation({
          request: async (method: string, params: { archived?: boolean }) => {
            if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
            return {
              data: await fetchThreads(context, params.archived ?? false),
              nextCursor: null,
            };
          },
        } as never);
      },
    },
  });
}

function cacheWithRequestHandlers(
  handlers: Record<string, (params: unknown) => Promise<unknown>>,
  context: AppServerQueryContextIdentity = cacheContext(),
): AppServerQueryCache {
  const requestClient = {
    request: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params);
    },
  };
  return new AppServerQueryCache(context, {
    clientRunner: {
      runWithClient: async (_context, operation) => operation(requestClient as never),
    },
  });
}

function metadataCacheWithSuccessfulHandlers(): AppServerQueryCache {
  return cacheWithRequestHandlers({
    "config/read": vi.fn().mockResolvedValue({}),
    "model/list": vi.fn().mockResolvedValue({ data: [] }),
    "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [] }] }),
    "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
  });
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

function thread(id: string, archived = false) {
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
