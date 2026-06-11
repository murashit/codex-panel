import { describe, expect, it, vi } from "vitest";

import { createAppServerDiagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../src/app-server/diagnostics";
import { SharedAppServerCache } from "../../src/app-server/shared-cache";
import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/app-server/runtime-config";
import type { SharedAppServerCacheContext, SharedAppServerMetadata } from "../../src/app-server/shared-cache-state";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";

describe("SharedAppServerCache", () => {
  it("does not store failed or empty metadata snapshots as shared cache truth", () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();
    const goodMetadata = metadata();

    cache.applyAppServerMetadataSnapshot(context, goodMetadata);
    expect(cache.cachedAppServerMetadata(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5"]);

    const invalidSnapshots = [
      metadata({ availableModels: [] }),
      metadata({ modelProbeStatus: "failed" }),
      metadata({ skillsProbeStatus: "failed" }),
      metadata({ rateLimitProbeStatus: "failed" }),
    ];

    for (const snapshot of invalidSnapshots) {
      cache.applyAppServerMetadataSnapshot(context, snapshot);
    }

    expect(cache.cachedAppServerMetadata(context)?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5"]);
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

  it("does not replace the shared thread list cache with an empty snapshot", async () => {
    const cache = new SharedAppServerCache();
    const context = cacheContext();
    const onSnapshot = vi.fn();

    cache.applyThreadListSnapshot(context, [thread("cached")]);
    cache.applyThreadListSnapshot(context, []);

    expect(cache.cachedThreadList(context)?.map((item) => item.id)).toEqual(["cached"]);

    await expect(cache.refreshThreadList(context, () => Promise.resolve([]), onSnapshot)).resolves.toEqual([]);
    expect(onSnapshot).toHaveBeenCalledWith([]);
    expect(cache.cachedThreadList(context)?.map((item) => item.id)).toEqual(["cached"]);
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
    runtimeConfig?: RuntimeConfigSnapshot | null;
    modelProbeStatus?: "ok" | "failed";
    skillsProbeStatus?: "ok" | "failed";
    rateLimitProbeStatus?: "ok" | "failed";
  } = {},
): SharedAppServerMetadata {
  const diagnostics = createAppServerDiagnostics();
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
    availableSkills: [],
    rateLimit: null,
    appServerDiagnostics: diagnostics,
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
