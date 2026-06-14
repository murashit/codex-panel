import { describe, expect, it, vi } from "vitest";

import { createServerDiagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../src/domain/server/diagnostics";
import { SharedAppServerCache } from "../../src/app-server/services/shared-cache";
import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/app-server/protocol/runtime-config";
import type { RateLimitSnapshot } from "../../src/app-server/protocol/runtime-metrics";
import type { SharedAppServerCacheContext, SharedServerMetadata } from "../../src/app-server/services/shared-cache-state";
import type { ModelMetadata, SkillMetadata } from "../../src/domain/catalog/metadata";

describe("SharedAppServerCache", () => {
  it("updates successful metadata resources while preserving failed resource cache values", () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();
    const goodMetadata = metadata({
      availableSkills: [skillMetadata("writer")],
      rateLimit: rateLimit(42),
    });

    cache.applyAppServerMetadataSnapshot(context, goodMetadata);
    expect(cache.cachedAppServerMetadata(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5"]);

    cache.applyAppServerMetadataSnapshot(
      context,
      metadata({
        availableModels: [modelMetadata("gpt-5.6")],
        availableSkills: [skillMetadata("stale-skill")],
        rateLimit: rateLimit(90),
        skillsProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    expect(cache.cachedAppServerMetadata(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.6"]);
    expect(cache.cachedAppServerMetadata(context)?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cache.cachedAppServerMetadata(context)?.rateLimit?.primary?.usedPercent).toBe(42);
    expect(cache.cachedAppServerMetadata(context)?.serverDiagnostics.probes["skills/list"].status).toBe("failed");
    expect(cache.cachedAppServerMetadata(context)?.serverDiagnostics.probes["account/rateLimits/read"].status).toBe("failed");

    cache.applyAppServerMetadataSnapshot(context, metadata({ availableModels: [], modelProbeStatus: "failed" }));
    expect(cache.cachedAppServerMetadata(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.6"]);
    expect(cache.cachedAppServerMetadata(context)?.serverDiagnostics.probes["model/list"].status).toBe("failed");
  });

  it("loads initial metadata snapshots without caching failed resource values", () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();

    cache.applyAppServerMetadataSnapshot(
      context,
      metadata({
        availableModels: [modelMetadata("failed-model")],
        availableSkills: [skillMetadata("writer")],
        rateLimit: rateLimit(90),
        modelProbeStatus: "failed",
        rateLimitProbeStatus: "failed",
      }),
    );

    const cached = cache.cachedAppServerMetadata(context);
    expect(cached?.runtimeConfig).not.toBeNull();
    expect(cached?.serverDiagnostics.probes["model/list"].status).toBe("failed");
    expect(cached?.availableModels).toEqual([]);
    expect(cached?.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cached?.rateLimit).toBeNull();
    expect(cache.cachedModels(context)).toBeNull();
  });

  it("does not share or store snapshots before the app-server identity is known", async () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext({ appServerUserAgent: null });
    const firstRefresh = deferred<readonly ReturnType<typeof thread>[]>();
    const firstFetch = vi.fn(() => firstRefresh.promise);
    const secondFetch = vi.fn().mockResolvedValue([thread("second")]);
    const onSnapshot = vi.fn();

    const firstPromise = cache.refreshThreadList(context, firstFetch, onSnapshot);
    await expect(cache.refreshThreadList(context, secondFetch, onSnapshot)).resolves.toEqual([thread("second")]);
    firstRefresh.resolve([thread("first")]);
    await expect(firstPromise).resolves.toEqual([thread("first")]);
    cache.applyThreadListSnapshot(context, [thread("applied")]);
    cache.applyAppServerMetadataSnapshot(context, metadata());
    cache.applyModelsSnapshot(context, [modelMetadata("gpt-5.6")]);

    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).toHaveBeenCalledOnce();
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(cache.cachedThreadList(context)).toBeNull();
    expect(cache.cachedAppServerMetadata(context)).toBeNull();
    expect(cache.cachedModels(context)).toBeNull();
  });

  it("does not replace shared models with an empty model snapshot", () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();

    cache.applyModelsSnapshot(context, [modelMetadata("gpt-5.5")]);
    cache.applyModelsSnapshot(context, []);

    expect(cache.cachedModels(context)?.map((model) => model.model)).toEqual(["gpt-5.5"]);
  });

  it("does not reuse metadata or model snapshots across app-server cache contexts", () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();

    cache.applyAppServerMetadataSnapshot(context, metadata());
    cache.applyModelsSnapshot(context, [modelMetadata("gpt-5.6")]);

    expect(cache.cachedAppServerMetadata(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.cachedAppServerMetadata(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
    expect(cache.cachedAppServerMetadata(cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toBeNull();
    expect(cache.cachedModels(cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cache.cachedModels(cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
    expect(cache.cachedModels(cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toBeNull();
  });

  it("stores successful empty thread list snapshots as shared cache truth", async () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();
    const onSnapshot = vi.fn();

    cache.applyThreadListSnapshot(context, [thread("cached")]);
    cache.applyThreadListSnapshot(context, []);

    expect(cache.cachedThreadList(context)).toEqual([]);

    await expect(cache.refreshThreadList(context, () => Promise.resolve([]), onSnapshot)).resolves.toEqual([]);
    expect(onSnapshot).toHaveBeenCalledWith([]);
    expect(cache.cachedThreadList(context)).toEqual([]);
  });

  it("ignores stale thread list refresh snapshots after the app-server cache context changes", async () => {
    const cache = new SharedAppServerCache();
    const oldContext = cacheContext({ appServerUserAgent: "codex-cli/1.2.3" });
    const newContext = cacheContext({ appServerUserAgent: "codex-cli/1.2.4" });
    const oldRefresh = deferred<readonly ReturnType<typeof thread>[]>();
    const newRefresh = deferred<readonly ReturnType<typeof thread>[]>();
    const oldSnapshot = vi.fn();
    const newSnapshot = vi.fn();

    const oldPromise = cache.refreshThreadList(oldContext, () => oldRefresh.promise, oldSnapshot);
    const newPromise = cache.refreshThreadList(newContext, () => newRefresh.promise, newSnapshot);

    oldRefresh.resolve([thread("old-thread")]);
    await expect(oldPromise).resolves.toEqual([thread("old-thread")]);
    expect(oldSnapshot).not.toHaveBeenCalled();
    expect(cache.cachedThreadList(oldContext)).toBeNull();

    newRefresh.resolve([thread("new-thread")]);
    await expect(newPromise).resolves.toEqual([thread("new-thread")]);
    expect(newSnapshot).toHaveBeenCalledWith([thread("new-thread")]);
    expect(cache.cachedThreadList(newContext)?.map((item) => item.id)).toEqual(["new-thread"]);
    expect(cache.cachedThreadList(oldContext)).toBeNull();
  });

  it("keys in-flight thread list refreshes by the captured app-server cache context", async () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext({ appServerUserAgent: "codex-cli/1.2.3" });
    const capturedContext = { ...context };
    const refresh = deferred<readonly ReturnType<typeof thread>[]>();
    const onSnapshot = vi.fn();

    const promise = cache.refreshThreadList(context, () => refresh.promise, onSnapshot);
    context.appServerUserAgent = "codex-cli/9.9.9";

    refresh.resolve([thread("captured")]);
    await expect(promise).resolves.toEqual([thread("captured")]);

    expect(onSnapshot).toHaveBeenCalledWith([thread("captured")]);
    expect(cache.cachedThreadList(capturedContext)?.map((item) => item.id)).toEqual(["captured"]);
    expect(cache.cachedThreadList(context)).toBeNull();
  });
});

function cacheContext(overrides: Partial<SharedAppServerCacheContext> = {}): SharedAppServerCacheContext {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    appServerUserAgent: "codex-cli/1.2.3",
    ...overrides,
  };
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
  const diagnostics = createServerDiagnostics();
  diagnostics.probes["model/list"] =
    overrides.modelProbeStatus === "failed"
      ? diagnosticProbeError("model/list", new Error("offline"))
      : diagnosticProbeOk("model/list", "1 models");
  diagnostics.probes["skills/list"] =
    overrides.skillsProbeStatus === "failed"
      ? diagnosticProbeError("skills/list", new Error("offline"))
      : diagnosticProbeOk("skills/list", "0 skills");
  diagnostics.probes["account/rateLimits/read"] =
    overrides.rateLimitProbeStatus === "failed"
      ? diagnosticProbeError("account/rateLimits/read", new Error("offline"))
      : diagnosticProbeOk("account/rateLimits/read", "available");
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
