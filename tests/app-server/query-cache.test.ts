import { describe, expect, it, vi } from "vitest";
import type { CatalogModel, CatalogSkillMetadata } from "../../src/app-server/protocol/catalog";
import { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { AppServerQueryContext } from "../../src/app-server/query/keys";
import type { SkillMetadata } from "../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/domain/runtime/config";
import type { RateLimitSnapshot } from "../../src/domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../src/domain/runtime/permissions";
import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  upsertMcpServerDiagnostic,
} from "../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../src/domain/server/metadata";

describe("AppServerQueryCache", () => {
  it("garbage-collects inactive query contexts", async () => {
    vi.useFakeTimers();
    try {
      const cache = cacheWithThreads(() => Promise.resolve([thread("temporary")]));
      const context = cacheContext();
      await cache.fetchActiveThreads(context);

      await vi.advanceTimersByTimeAsync(300_001);

      expect(cache.activeThreadsSnapshot(context)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves successful metadata resource values when probes fail", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();
    const goodMetadata = metadata({
      availableSkills: [skillMetadata("writer")],
      availablePermissionProfiles: [permissionProfile(":workspace")],
      rateLimit: rateLimit(42),
    });

    cache.writeAppServerMetadata(context, goodMetadata);
    cache.writeAppServerMetadata(
      context,
      metadata({
        availableSkills: [skillMetadata("failed-skill")],
        availablePermissionProfiles: [permissionProfile(":failed")],
        rateLimit: rateLimit(90),
        skillsProbeStatus: "failed",
        permissionProfilesProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    expect(cache.appServerMetadataSnapshot(context)?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cache.appServerMetadataSnapshot(context)?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":workspace"]);
    expect(cache.appServerMetadataSnapshot(context)?.rateLimit?.primary?.usedPercent).toBe(42);
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes.skills.status).toBe("failed");
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes.rateLimits.status).toBe("failed");

    cache.writeAppServerMetadata(context, metadata({ modelProbeStatus: "failed" }));
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes.models.status).toBe("failed");
  });

  it("model-checks last-known-good metadata fallback for all probe status combinations", () => {
    for (const statuses of metadataProbeStatusCombinations()) {
      const cache = new AppServerQueryCache();
      const context = cacheContext();
      cache.writeAppServerMetadata(
        context,
        metadata({
          availableSkills: [skillMetadata("previous-skill")],
          availablePermissionProfiles: [permissionProfile(":previous")],
          rateLimit: rateLimit(11),
        }),
      );

      cache.writeAppServerMetadata(
        context,
        metadata({
          availableSkills: [skillMetadata("next-skill")],
          availablePermissionProfiles: [permissionProfile(":next")],
          rateLimit: rateLimit(22),
          modelProbeStatus: statuses.models,
          skillsProbeStatus: statuses.skills,
          permissionProfilesProbeStatus: statuses.permissionProfiles,
          rateLimitProbeStatus: statuses.rateLimits,
        }),
      );

      const snapshot = cache.appServerMetadataSnapshot(context);
      const statusCase = metadataProbeStatusCase(statuses);
      expect(
        snapshot?.availableSkills.map((skill) => skill.name),
        statusCase,
      ).toEqual([statuses.skills === "ok" ? "next-skill" : "previous-skill"]);
      expect(
        snapshot?.availablePermissionProfiles.map((profile) => profile.id),
        statusCase,
      ).toEqual([statuses.permissionProfiles === "ok" ? ":next" : ":previous"]);
      expect(snapshot?.rateLimit?.primary?.usedPercent, statusCase).toBe(statuses.rateLimits === "ok" ? 22 : 11);
    }
  });

  it("does not accept failed metadata resource payloads as cache truth", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();

    cache.writeAppServerMetadata(
      context,
      metadata({
        availableSkills: [skillMetadata("writer")],
        availablePermissionProfiles: [permissionProfile(":workspace")],
        rateLimit: rateLimit(90),
        modelProbeStatus: "failed",
        skillsProbeStatus: "failed",
        permissionProfilesProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    const cached = cache.appServerMetadataSnapshot(context);
    expect(cached?.runtimeConfig).not.toBeNull();
    expect(cached?.serverDiagnostics.probes.models.status).toBe("failed");
    expect(cached?.availableSkills).toEqual([]);
    expect(cached?.availablePermissionProfiles).toEqual([]);
    expect(cached?.rateLimit).toBeNull();
    expect(cache.modelsSnapshot(context)).toBeNull();
  });

  it("keeps connection and thread diagnostics out of shared metadata snapshots", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();
    const polluted = metadata();
    polluted.serverDiagnostics = diagnosticsWithToolInventory(
      upsertMcpServerDiagnostic(polluted.serverDiagnostics, {
        name: "github",
        startupStatus: "ready",
        authStatus: null,
        toolCount: 1,
        message: null,
      }),
      {
        checkedAt: 1,
        plugins: [],
        pluginMarketplaceErrors: [],
        pluginsError: null,
        mcpServers: [],
        mcpDiagnostics: [],
        mcpError: null,
        skills: [],
        skillsError: null,
      },
    );

    cache.writeAppServerMetadata(context, polluted);

    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics).toMatchObject({
      mcpServers: [],
      toolInventory: null,
      probes: {
        models: { status: "ok" },
        skills: { status: "ok" },
        permissionProfiles: { status: "ok" },
        rateLimits: { status: "ok" },
        plugins: { status: "unknown" },
        mcpServers: { status: "unknown" },
      },
    });
  });

  it("does not share or store snapshots before the cache context is complete", async () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext({ codexPath: "" });

    await expect(cache.fetchActiveThreads(context)).resolves.toEqual([]);
    cache.writeAppServerMetadata(context, metadata());

    expect(cache.activeThreadsSnapshot(context)).toBeNull();
    expect(cache.appServerMetadataSnapshot(context)).toBeNull();
    expect(cache.modelsSnapshot(context)).toBeNull();
  });

  it("does not let metadata writes overwrite the model query", async () => {
    const cache = cacheWithRequestHandlers({
      "model/list": vi.fn().mockResolvedValue({ data: [catalogModel("gpt-model-query")] }),
    });
    const context = cacheContext();

    await cache.fetchModels(context);
    cache.writeAppServerMetadata(context, metadata({ modelProbeStatus: "failed" }));

    expect(cache.modelsSnapshot(context)?.map((model) => model.model)).toEqual(["gpt-model-query"]);
  });

  it("does not reuse metadata or model snapshots across app-server cache contexts", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();

    cache.writeAppServerMetadata(context, metadata());

    expect(cache.appServerMetadataSnapshot(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.appServerMetadataSnapshot(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
    expect(cache.modelsSnapshot(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.modelsSnapshot(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);
    const context = cacheContext();

    await expect(cache.refreshActiveThreads(context)).resolves.toEqual([]);
    expect(cache.activeThreadsSnapshot(context)).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
  });

  it("keeps active and archived thread list snapshots separate", async () => {
    const fetchThreads = vi.fn((_context: AppServerQueryContext, archived: boolean) =>
      Promise.resolve(archived ? [thread("archived", true)] : [thread("active")]),
    );
    const cache = cacheWithThreads(fetchThreads);
    const context = cacheContext();

    await expect(cache.refreshActiveThreads(context)).resolves.toEqual([thread("active")]);
    await expect(cache.refreshArchivedThreads(context)).resolves.toEqual([thread("archived", true)]);

    expect(cache.activeThreadsSnapshot(context)).toEqual([thread("active")]);
    expect(cache.archivedThreadsSnapshot(context)).toEqual([thread("archived", true)]);
    expect(fetchThreads).toHaveBeenNthCalledWith(1, context, false);
    expect(fetchThreads).toHaveBeenNthCalledWith(2, context, true);
  });

  it("loads active thread history one page at a time", async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ data: [thread("first")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [thread("second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    const context = cacheContext();

    await expect(cache.refreshActiveThreads(context)).resolves.toEqual([thread("first")]);
    expect(cache.hasMoreActiveThreads(context)).toBe(true);
    expect(listThreads).toHaveBeenCalledOnce();

    await expect(cache.loadMoreActiveThreads(context)).resolves.toEqual([thread("first"), thread("second")]);
    expect(cache.hasMoreActiveThreads(context)).toBe(false);
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
    const context = cacheContext();
    await cache.refreshActiveThreads(context);

    const loadMore = cache.loadMoreActiveThreads(context);
    await Promise.resolve();
    await cache.refreshActiveThreads(context);
    oldPage.resolve({ data: [thread("old-second")], nextCursor: null });

    await expect(loadMore).resolves.toEqual([thread("new-first")]);
    expect(cache.activeThreadsSnapshot(context)).toEqual([thread("new-first")]);
    expect(cache.hasMoreActiveThreads(context)).toBe(true);
  });

  it("retries a full active-thread inventory when a first-page refresh wins the race", async () => {
    const oldInventory = deferred<{ data: ReturnType<typeof thread>[]; nextCursor: string | null }>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => oldInventory.promise)
      .mockResolvedValueOnce({ data: [thread("new-first")], nextCursor: "new-page-2" })
      .mockResolvedValueOnce({ data: [thread("new-first"), thread("new-second")], nextCursor: null });
    const cache = cacheWithRequestHandlers({ "thread/list": listThreads });
    const context = cacheContext();

    const inventory = cache.fetchAllActiveThreads(context);
    await flushMicrotasks();
    await cache.refreshActiveThreads(context);
    oldInventory.resolve({ data: [thread("old")], nextCursor: null });

    await expect(inventory).resolves.toEqual([thread("new-first"), thread("new-second")]);
    expect(cache.activeThreadsSnapshot(context)).toEqual([thread("new-first"), thread("new-second")]);
  });

  it("keys thread list refresh snapshots by app-server query context", async () => {
    const oldContext = cacheContext({ codexPath: "codex-old" });
    const newContext = cacheContext({ codexPath: "codex-new" });
    const oldRefresh = deferred<readonly ReturnType<typeof thread>[]>();
    const newRefresh = deferred<readonly ReturnType<typeof thread>[]>();
    const fetchThreads = vi.fn((context: AppServerQueryContext) =>
      context.codexPath === "codex-old" ? oldRefresh.promise : newRefresh.promise,
    );
    const cache = cacheWithThreads(fetchThreads);

    const oldPromise = cache.refreshActiveThreads(oldContext);
    const newPromise = cache.refreshActiveThreads(newContext);

    oldRefresh.resolve([thread("old-thread")]);
    await expect(oldPromise).resolves.toEqual([thread("old-thread")]);
    expect(cache.activeThreadsSnapshot(oldContext)?.map((item) => item.id)).toEqual(["old-thread"]);

    newRefresh.resolve([thread("new-thread")]);
    await expect(newPromise).resolves.toEqual([thread("new-thread")]);
    expect(cache.activeThreadsSnapshot(newContext)?.map((item) => item.id)).toEqual(["new-thread"]);
    expect(cache.activeThreadsSnapshot(oldContext)?.map((item) => item.id)).toEqual(["old-thread"]);
  });

  it("stores in-flight thread list refreshes under the captured app-server cache context", async () => {
    const context = cacheContext({ codexPath: "codex-captured" });
    const capturedContext = { ...context };
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const cache = cacheWithThreads(() => refresh.promise);

    const promise = cache.refreshActiveThreads(context);
    context.codexPath = "codex-mutated";

    refresh.resolve([thread("captured")]);
    await expect(promise).resolves.toEqual([thread("captured")]);

    expect(cache.activeThreadsSnapshot(capturedContext)?.map((item) => item.id)).toEqual(["captured"]);
    expect(cache.activeThreadsSnapshot(context)).toBeNull();
  });

  it("fetches app-server metadata and models through their respective query records", async () => {
    const context = cacheContext();
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [catalogModel("gpt-meta")] }),
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [catalogSkill("writer")] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [permissionProfile(":workspace")], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(64), rateLimitsByLimitId: null }),
    });

    const metadata = await cache.refreshAppServerMetadata(context);

    expect(metadata?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(metadata?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":workspace"]);
    expect(metadata?.rateLimit?.primary?.usedPercent).toBe(64);
    expect(metadata?.serverDiagnostics.probes.models.status).toBe("ok");
    expect(cache.modelsSnapshot(context)?.map((model) => model.model)).toEqual(["gpt-meta"]);
  });

  it("shares in-flight model fetches between metadata and models queries", async () => {
    const context = cacheContext();
    const modelRefresh = deferred<{ data: CatalogModel[] }>();
    const listModels = vi.fn(() => modelRefresh.promise);
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": listModels,
      "skills/list": vi.fn().mockResolvedValue({ data: [{ skills: [] }] }),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });

    const metadataPromise = cache.refreshAppServerMetadata(context);
    await flushMicrotasks();
    const modelsPromise = cache.fetchModels(context);
    await flushMicrotasks();

    expect(listModels).toHaveBeenCalledOnce();

    modelRefresh.resolve({ data: [catalogModel("gpt-shared")] });

    await expect(modelsPromise).resolves.toMatchObject([{ model: "gpt-shared" }]);
    await expect(metadataPromise).resolves.toMatchObject({ serverDiagnostics: { probes: { models: { status: "ok" } } } });
    expect(listModels).toHaveBeenCalledOnce();
    expect(cache.modelsSnapshot(context)?.map((model) => model.model)).toEqual(["gpt-shared"]);
  });

  it("keeps query-cached models when app-server metadata model refresh fails", async () => {
    const context = cacheContext();
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
    await cache.fetchModels(context);

    const metadataSnapshot = await cache.refreshAppServerMetadata(context);

    expect(metadataSnapshot?.serverDiagnostics.probes.models.status).toBe("failed");
    expect(cache.modelsSnapshot(context)?.map((model) => model.model)).toEqual(["gpt-cached"]);
  });

  it("keeps every last-known-good resource through the full metadata refresh path", async () => {
    const context = cacheContext();
    const listModels = vi
      .fn()
      .mockResolvedValueOnce({ data: [catalogModel("gpt-cached")] })
      .mockRejectedValueOnce(new Error("models offline"));
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": listModels,
      "skills/list": vi.fn().mockRejectedValue(new Error("skills offline")),
      "permissionProfile/list": vi.fn().mockRejectedValue(new Error("profiles offline")),
      "account/rateLimits/read": vi.fn().mockRejectedValue(new Error("limits offline")),
    });
    cache.writeAppServerMetadata(
      context,
      metadata({
        availableSkills: [skillMetadata("cached-skill")],
        availablePermissionProfiles: [permissionProfile(":cached")],
        rateLimit: rateLimit(17),
      }),
    );
    await cache.fetchModels(context);

    const refreshed = await cache.refreshAppServerMetadata(context);

    expect(cache.modelsSnapshot(context)?.map((model) => model.model)).toEqual(["gpt-cached"]);
    expect(refreshed?.availableSkills.map((skill) => skill.name)).toEqual(["cached-skill"]);
    expect(refreshed?.availablePermissionProfiles.map((profile) => profile.id)).toEqual([":cached"]);
    expect(refreshed?.rateLimit?.primary?.usedPercent).toBe(17);
    expect(refreshed?.serverDiagnostics.probes).toMatchObject({
      models: { status: "failed" },
      skills: { status: "failed" },
      permissionProfiles: { status: "failed" },
      rateLimits: { status: "failed" },
    });
    expect(cache.appServerMetadataSnapshot(context)).toEqual(refreshed);
  });

  it("does not overwrite a newer sparse metadata write with an in-flight full refresh", async () => {
    const skills = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const cache = cacheWithRequestHandlers({
      "config/read": vi.fn().mockResolvedValue({}),
      "model/list": vi.fn().mockResolvedValue({ data: [] }),
      "skills/list": vi.fn(() => skills.promise),
      "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: appServerRateLimit(0), rateLimitsByLimitId: null }),
    });
    const context = cacheContext();
    cache.writeAppServerMetadata(context, metadata({ availableSkills: [skillMetadata("initial")] }));
    for (let index = 0; index < 5; index += 1) cache.beginMetadataResourceRefresh(context, "skills");
    const refresh = cache.refreshAppServerMetadata(context);
    await flushMicrotasks();

    cache.updateAppServerMetadata(
      context,
      () => metadata({ availableSkills: [skillMetadata("event")], rateLimit: rateLimit(42) }),
      "rateLimits",
    );
    skills.resolve({ data: [{ skills: [catalogSkill("old-full")] }] });

    await expect(refresh).resolves.toMatchObject({ availableSkills: [{ name: "event" }] });
    expect(cache.appServerMetadataSnapshot(context)?.availableSkills.map((skill) => skill.name)).toEqual(["event"]);
  });

  it("stores an in-flight app-server snapshot as raw thread-list truth", async () => {
    const context = cacheContext();
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const cache = cacheWithThreads(() => refresh.promise);

    const promise = cache.refreshActiveThreads(context);
    await flushMicrotasks();

    refresh.resolve([thread("thread"), thread("other")]);

    await expect(promise).resolves.toEqual([thread("thread"), thread("other")]);
    expect(cache.activeThreadsSnapshot(context)).toEqual([thread("thread"), thread("other")]);
  });
});

function cacheContext(overrides: Partial<AppServerQueryContext> = {}): AppServerQueryContext {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    ...overrides,
  };
}

function cacheWithThreads(
  fetchThreads: (context: AppServerQueryContext, archived: boolean) => Promise<readonly ReturnType<typeof thread>[]>,
): AppServerQueryCache {
  return new AppServerQueryCache({
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

function cacheWithRequestHandlers(handlers: Record<string, (params: unknown) => Promise<unknown>>): AppServerQueryCache {
  const requestClient = {
    request: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params);
    },
  };
  return new AppServerQueryCache({
    clientRunner: {
      runWithClient: async (_context, operation) => operation(requestClient as never),
    },
  });
}

function metadata(
  overrides: {
    availableSkills?: readonly SkillMetadata[];
    availablePermissionProfiles?: readonly RuntimePermissionProfileSummary[];
    rateLimit?: RateLimitSnapshot | null;
    runtimeConfig?: RuntimeConfigSnapshot | null;
    modelProbeStatus?: "ok" | "failed";
    skillsProbeStatus?: "ok" | "failed";
    permissionProfilesProbeStatus?: "ok" | "failed";
    rateLimitProbeStatus?: "ok" | "failed";
  } = {},
): SharedServerMetadata {
  let diagnostics = createServerDiagnostics();
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.modelProbeStatus === "failed"
      ? diagnosticProbeError("models", new Error("offline"), 1)
      : diagnosticProbeOk("models", "1 models", 1),
  );
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.skillsProbeStatus === "failed"
      ? diagnosticProbeError("skills", new Error("offline"), 1)
      : diagnosticProbeOk("skills", "0 skills", 1),
  );
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.rateLimitProbeStatus === "failed"
      ? diagnosticProbeError("rateLimits", new Error("offline"), 1)
      : diagnosticProbeOk("rateLimits", "available", 1),
  );
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.permissionProfilesProbeStatus === "failed"
      ? diagnosticProbeError("permissionProfiles", new Error("offline"), 1)
      : diagnosticProbeOk("permissionProfiles", "0 profiles", 1),
  );
  return {
    runtimeConfig: overrides.runtimeConfig ?? emptyRuntimeConfigSnapshot(),
    availableSkills: overrides.availableSkills ?? [],
    availablePermissionProfiles: overrides.availablePermissionProfiles ?? [],
    rateLimit: overrides.rateLimit ?? null,
    serverDiagnostics: diagnostics,
  };
}

type MetadataProbeStatus = "ok" | "failed";

interface MetadataProbeStatuses {
  readonly models: MetadataProbeStatus;
  readonly skills: MetadataProbeStatus;
  readonly permissionProfiles: MetadataProbeStatus;
  readonly rateLimits: MetadataProbeStatus;
}

function metadataProbeStatusCombinations(): MetadataProbeStatuses[] {
  const statuses: readonly MetadataProbeStatus[] = ["ok", "failed"];
  return statuses.flatMap((models) =>
    statuses.flatMap((skills) =>
      statuses.flatMap((permissionProfiles) => statuses.map((rateLimits) => ({ models, skills, permissionProfiles, rateLimits }))),
    ),
  );
}

function metadataProbeStatusCase(statuses: MetadataProbeStatuses): string {
  return `models=${statuses.models} skills=${statuses.skills} permissionProfiles=${statuses.permissionProfiles} rateLimits=${statuses.rateLimits}`;
}

function skillMetadata(name: string): SkillMetadata {
  return { name, description: "", path: `/tmp/${name}`, enabled: true };
}

function permissionProfile(id: string): RuntimePermissionProfileSummary {
  return { id, description: null, allowed: true };
}

function rateLimit(usedPercent: number): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    primary: { usedPercent, windowDurationMins: 300, resetsAt: 1 },
    secondary: null,
    individualLimit: null,
    rateLimitReachedType: null,
  };
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
    additionalSpeedTiers: [],
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
