import { describe, expect, it, vi } from "vitest";

import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
} from "../../src/domain/server/diagnostics";
import { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { AppServerQueryContext } from "../../src/app-server/query/keys";
import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/app-server/protocol/runtime-config";
import type { RateLimitSnapshot } from "../../src/app-server/protocol/runtime-metrics";
import type { SharedServerMetadata } from "../../src/app-server/query/snapshots";
import type { ModelMetadata, SkillMetadata } from "../../src/domain/catalog/metadata";

describe("AppServerQueryCache", () => {
  it("stores metadata snapshots without replacing failed resource values with stale data", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();
    const goodMetadata = metadata({
      availableSkills: [skillMetadata("writer")],
      rateLimit: rateLimit(42),
    });

    cache.setAppServerMetadata(context, goodMetadata);
    expect(cache.appServerMetadataSnapshot(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5"]);

    cache.setAppServerMetadata(
      context,
      metadata({
        availableModels: [modelMetadata("gpt-5.6")],
        availableSkills: [skillMetadata("stale-skill")],
        rateLimit: rateLimit(90),
        skillsProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    expect(cache.appServerMetadataSnapshot(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.6"]);
    expect(cache.appServerMetadataSnapshot(context)?.availableSkills.map((skill) => skill.name)).toEqual(["stale-skill"]);
    expect(cache.appServerMetadataSnapshot(context)?.rateLimit?.primary?.usedPercent).toBe(90);
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes["skills/list"].status).toBe("failed");
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes["account/rateLimits/read"].status).toBe("failed");

    cache.setAppServerMetadata(context, metadata({ availableModels: [], modelProbeStatus: "failed" }));
    expect(cache.appServerMetadataSnapshot(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.6"]);
    expect(cache.appServerMetadataSnapshot(context)?.serverDiagnostics.probes["model/list"].status).toBe("failed");
  });

  it("does not accept failed metadata model payloads as model cache truth", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();

    cache.setAppServerMetadata(
      context,
      metadata({
        availableModels: [modelMetadata("failed-model")],
        availableSkills: [skillMetadata("writer")],
        rateLimit: rateLimit(90),
        modelProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    const cached = cache.appServerMetadataSnapshot(context);
    expect(cached?.runtimeConfig).not.toBeNull();
    expect(cached?.serverDiagnostics.probes["model/list"].status).toBe("failed");
    expect(cached?.availableModels).toEqual([]);
    expect(cached?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cached?.rateLimit?.primary?.usedPercent).toBe(90);
    expect(cache.modelsSnapshot(context)).toBeNull();
  });

  it("does not share or store snapshots before the cache context is complete", async () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext({ codexPath: "" });

    await expect(cache.fetchActiveThreads(context)).resolves.toEqual([]);
    cache.setActiveThreads(context, [thread("applied")]);
    cache.setAppServerMetadata(context, metadata());

    expect(cache.activeThreadsSnapshot(context)).toBeNull();
    expect(cache.appServerMetadataSnapshot(context)).toBeNull();
    expect(cache.modelsSnapshot(context)).toBeNull();
  });

  it("stores successful empty model snapshots as shared cache truth", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();

    cache.setAppServerMetadata(context, metadata({ availableModels: [modelMetadata("gpt-5.6")] }));
    cache.setAppServerMetadata(context, metadata({ availableModels: [] }));

    expect(cache.appServerMetadataSnapshot(context)?.availableModels).toEqual([]);
    expect(cache.modelsSnapshot(context)).toEqual([]);
  });

  it("does not reuse metadata or model snapshots across app-server cache contexts", () => {
    const cache = new AppServerQueryCache();
    const context = cacheContext();

    cache.setAppServerMetadata(context, metadata());

    expect(cache.appServerMetadataSnapshot(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.appServerMetadataSnapshot(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
    expect(cache.modelsSnapshot(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.modelsSnapshot(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([]);
    const cache = cacheWithThreads(fetchThreads);
    const context = cacheContext();

    cache.setActiveThreads(context, [thread("cached")]);
    cache.setActiveThreads(context, []);

    expect(cache.activeThreadsSnapshot(context)).toEqual([]);

    await expect(cache.refreshActiveThreads(context)).resolves.toEqual([]);
    expect(cache.activeThreadsSnapshot(context)).toEqual([]);
    expect(fetchThreads).toHaveBeenCalledOnce();
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
});

function cacheContext(overrides: Partial<AppServerQueryContext> = {}): AppServerQueryContext {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    ...overrides,
  };
}

function cacheWithThreads(
  fetchThreads: (context: AppServerQueryContext) => Promise<readonly ReturnType<typeof thread>[]>,
): AppServerQueryCache {
  return new AppServerQueryCache({
    clientRunner: {
      runWithClient: async (context, operation) => {
        return operation({
          listThreads: async () => ({
            data: await fetchThreads(context),
            nextCursor: null,
          }),
        } as never);
      },
    },
  });
}

function metadata(
  overrides: {
    availableModels?: readonly ModelMetadata[];
    availableSkills?: readonly SkillMetadata[];
    rateLimit?: RateLimitSnapshot | null;
    runtimeConfig?: RuntimeConfigSnapshot | null;
    modelProbeStatus?: "ok" | "failed";
    skillsProbeStatus?: "ok" | "failed";
    rateLimitProbeStatus?: "ok" | "failed";
  } = {},
): SharedServerMetadata {
  let diagnostics = createServerDiagnostics();
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.modelProbeStatus === "failed"
      ? diagnosticProbeError("model/list", new Error("offline"))
      : diagnosticProbeOk("model/list", "1 models"),
  );
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.skillsProbeStatus === "failed"
      ? diagnosticProbeError("skills/list", new Error("offline"))
      : diagnosticProbeOk("skills/list", "0 skills"),
  );
  diagnostics = diagnosticsWithProbe(
    diagnostics,
    overrides.rateLimitProbeStatus === "failed"
      ? diagnosticProbeError("account/rateLimits/read", new Error("offline"))
      : diagnosticProbeOk("account/rateLimits/read", "available"),
  );
  return {
    runtimeConfig: overrides.runtimeConfig ?? emptyRuntimeConfigSnapshot(),
    availableModels: overrides.availableModels ?? [modelMetadata("gpt-5.5")],
    availableSkills: overrides.availableSkills ?? [],
    rateLimit: overrides.rateLimit ?? null,
    serverDiagnostics: diagnostics,
  };
}

function skillMetadata(name: string): SkillMetadata {
  return { name, description: "", path: `/tmp/${name}`, enabled: true };
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

function modelMetadata(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

function thread(id: string) {
  return {
    id,
    preview: "",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
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
