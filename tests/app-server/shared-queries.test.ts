import { describe, expect, it, vi } from "vitest";

import type { AppServerQueryCache } from "../../src/app-server/query/cache";
import { AppServerSharedQueries, StaleAppServerSharedQueryContextError } from "../../src/app-server/query/shared-queries";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import type { ObservedResult } from "../../src/domain/observed-result";
import { createServerDiagnostics, diagnosticProbeOk, diagnosticsWithProbe } from "../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../src/domain/server/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { deferred } from "../support/async";

describe("AppServerSharedQueries", () => {
  it("rejects active thread refreshes when the app-server query context changes while loading", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const pending = deferred<readonly Thread[]>();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        refreshActiveThreads: vi.fn(() => pending.promise),
      }),
      context: () => context,
    });

    const refresh = queries.refreshActiveThreads();
    context.codexPath = "codex-b";
    pending.resolve([thread("stale")]);

    await expect(refresh).rejects.toBeInstanceOf(StaleAppServerSharedQueryContextError);
  });

  it("rejects metadata refreshes when the app-server query context changes while loading", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const pending = deferred<SharedServerMetadata | null>();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        refreshAppServerMetadata: vi.fn(() => pending.promise),
      }),
      context: () => context,
    });

    const refresh = queries.refreshAppServerMetadata();
    context.vaultPath = "/other-vault";
    pending.resolve(serverMetadata({ availableModels: [model("stale-model")] }));

    await expect(refresh).rejects.toBeInstanceOf(StaleAppServerSharedQueryContextError);
  });

  it("rejects model fetches when the app-server query context changes while loading", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const pending = deferred<readonly ModelMetadata[]>();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        fetchModels: vi.fn(() => pending.promise),
      }),
      context: () => context,
    });

    const fetch = queries.fetchModels();
    context.codexPath = "codex-b";
    pending.resolve([model("stale-model")]);

    await expect(fetch).rejects.toBeInstanceOf(StaleAppServerSharedQueryContextError);
  });

  it("does not notify stale active thread observers after the app-server query context changes", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const listener = vi.fn();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        observeActiveThreadsResult: (_queryContext, queryListener) => {
          observedThreadListener = queryListener;
          return () => undefined;
        },
      }),
      context: () => context,
    });
    let observedThreadListener!: (result: ObservedResult<readonly Thread[]>) => void;

    queries.observeActiveThreadsResult(listener);
    context.codexPath = "codex-b";
    observedThreadListener(observedResult([thread("stale")]));

    expect(listener).not.toHaveBeenCalled();
  });

  it("resubscribes observers when the app-server query context changes", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const listeners = new Map<string, (result: ObservedResult<readonly Thread[]>) => void>();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        observeActiveThreadsResult: (queryContext, listener) => {
          listeners.set(queryContext.codexPath, listener);
          return () => undefined;
        },
      }),
      context: () => context,
    });
    const listener = vi.fn();
    queries.observeActiveThreadsResult(listener);

    listeners.get("codex-a")?.(observedResult([thread("a")]));
    context.codexPath = "codex-b";
    queries.notifyContextChanged();
    listeners.get("codex-b")?.(observedResult([thread("b")]));

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("b")] }));
  });

  it("publishes metadata and model snapshots to shared query observers", () => {
    const metadata = serverMetadata({ availableModels: [model("gpt-test")] });
    const metadataListener = vi.fn();
    const modelListener = vi.fn();
    const queries = new AppServerSharedQueries({
      cache: cacheWith({
        appServerMetadataSnapshot: () => metadata,
        updateAppServerMetadata: () => metadata,
        modelsSnapshot: () => metadata.availableModels,
        observeAppServerMetadataResult: (_context, listener) => {
          metadataObserver = listener;
          return () => undefined;
        },
        observeModelsResult: (_context, listener) => {
          modelObserver = listener;
          return () => undefined;
        },
      }),
      context: () => ({ codexPath: "codex", vaultPath: "/vault" }),
    });
    let metadataObserver!: (result: ObservedResult<SharedServerMetadata>) => void;
    let modelObserver!: (result: ObservedResult<readonly ModelMetadata[]>) => void;

    queries.observeAppServerMetadataResult(metadataListener);
    queries.observeModelsResult(modelListener);
    queries.updateAppServerMetadata(() => metadata);
    metadataObserver(observedResult(metadata));
    modelObserver(observedResult(metadata.availableModels));

    expect(queries.appServerMetadataSnapshot()).toEqual(metadata);
    expect(queries.modelsSnapshot()).toEqual(metadata.availableModels);
    expect(metadataListener).toHaveBeenLastCalledWith(expect.objectContaining({ value: metadata }));
    expect(modelListener).toHaveBeenCalledWith(expect.objectContaining({ value: metadata.availableModels }));
  });
});

function cacheWith(overrides: Partial<AppServerQueryCache>): AppServerQueryCache {
  return {
    activeThreadsSnapshot: vi.fn(() => null),
    fetchActiveThreads: vi.fn(() => Promise.resolve([])),
    refreshActiveThreads: vi.fn(() => Promise.resolve([])),
    setActiveThreads: vi.fn(),
    updateActiveThreads: vi.fn(() => null),
    observeActiveThreadsResult: vi.fn(() => () => undefined),
    appServerMetadataSnapshot: vi.fn(() => null),
    updateAppServerMetadata: vi.fn(() => null),
    refreshAppServerMetadata: vi.fn(() => Promise.resolve(null)),
    observeAppServerMetadataResult: vi.fn(() => () => undefined),
    modelsSnapshot: vi.fn(() => null),
    fetchModels: vi.fn(() => Promise.resolve([])),
    refreshModels: vi.fn(() => Promise.resolve([])),
    observeModelsResult: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as AppServerQueryCache;
}

function observedResult<T>(value: T): ObservedResult<T> {
  return { value, error: null, isFetching: false };
}

function thread(id: string): Thread {
  return {
    id,
    preview: id,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}

function model(modelId: string): ModelMetadata {
  return {
    id: modelId,
    model: modelId,
    displayName: modelId,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    inputModalities: [],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

function serverMetadata(overrides: Partial<SharedServerMetadata> = {}): SharedServerMetadata {
  const diagnostics = diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("model/list", "0 models", 1));
  return {
    runtimeConfig: null,
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    serverDiagnostics: diagnostics,
    ...overrides,
  };
}
