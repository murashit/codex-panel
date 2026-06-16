import { describe, expect, it, vi, type Mock } from "vitest";

import { AppServerQueryCache } from "../../src/app-server/query/cache";
import { AppServerSharedQueries } from "../../src/app-server/query/shared-queries";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { createServerDiagnostics, diagnosticProbeOk, diagnosticsWithProbe } from "../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../src/domain/server/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { SharedThreadCatalog } from "../../src/workspace/shared-thread-catalog";

interface MockSurfaceActions {
  refreshOpenViews: Mock<() => void>;
  invalidateThreadsFromOpenSurface: Mock<() => void>;
  applyThreadArchived: Mock<(threadId: string, options?: { closeOpenPanels?: boolean }) => void>;
  applyThreadRenamed: Mock<(threadId: string, name: string | null) => void>;
  refreshThreadsViewLiveState: Mock<() => void>;
}

describe("SharedThreadCatalog", () => {
  it("applies thread snapshots to the shared cache and active observers", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread")];
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);

    catalog.setActiveThreads(threads);

    expect(catalog.activeThreadsSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: threads }));
  });

  it("refreshes thread snapshots through the cache single-flight and notifies observers once", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([thread("thread")]);
    const { catalog } = catalogFixture({ fetchThreads });
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);

    const first = catalog.refreshActiveThreads();
    const second = catalog.refreshActiveThreads();

    await expect(first).resolves.toEqual([thread("thread")]);
    await expect(second).resolves.toEqual([thread("thread")]);
    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(catalog.activeThreadsSnapshot()).toEqual([thread("thread")]);
    expect(listener.mock.calls.filter(([result]) => result.data !== null)).toHaveLength(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("thread")] }));
  });

  it("does not notify stale thread observers after the app-server query context changes", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const surfaces = surfaceActions();
    const queries = new AppServerSharedQueries({
      cache: cacheWithThreads((queryContext) => {
        expect(queryContext.codexPath).toBe("codex-a");
        return new Promise<Thread[]>((resolve) => {
          resolveThreads = resolve;
        });
      }),
      context: () => context,
    });
    const catalog = new SharedThreadCatalog({
      queries,
      surfaces,
    });
    let resolveThreads!: (threads: Thread[]) => void;
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);

    const fetch = catalog.refreshActiveThreads();
    await flushMicrotasks();
    context.codexPath = "codex-b";
    listener.mockClear();
    resolveThreads([thread("stale")]);

    await expect(fetch).resolves.toEqual([thread("stale")]);
    expect(listener).not.toHaveBeenCalled();
    context.codexPath = "codex-a";
    expect(catalog.activeThreadsSnapshot()).toEqual([thread("stale")]);
  });

  it("resubscribes active observers when the app-server query context changes", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const queries = new AppServerSharedQueries({
      cache: new AppServerQueryCache(),
      context: () => context,
    });
    const catalog = new SharedThreadCatalog({
      queries,
      surfaces: surfaceActions(),
    });
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);

    catalog.setActiveThreads([thread("a")]);
    context.codexPath = "codex-b";
    queries.notifyContextChanged();
    catalog.setActiveThreads([thread("b")]);

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("b")] }));
    context.codexPath = "codex-a";
    queries.notifyContextChanged();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("a")] }));
  });

  it("publishes metadata and model snapshots to shared query observers", () => {
    const { queries } = catalogFixture();
    const metadata = serverMetadata({ availableModels: [model("gpt-test")] });
    const metadataListener = vi.fn();
    const modelListener = vi.fn();
    queries.observeAppServerMetadataResult(metadataListener);
    queries.observeModelsResult(modelListener);

    queries.updateAppServerMetadata(() => metadata);

    expect(queries.appServerMetadataSnapshot()).toEqual(metadata);
    expect(queries.modelsSnapshot()).toEqual(metadata.availableModels);
    expect(metadataListener).toHaveBeenLastCalledWith(expect.objectContaining({ data: metadata }));
    expect(modelListener).toHaveBeenCalledWith(expect.objectContaining({ data: metadata.availableModels }));
  });

  it("applies known rename mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);
    catalog.setActiveThreads([thread("thread"), thread("other")]);

    catalog.renameThreadInCatalog("thread", "Renamed");

    expect(catalog.activeThreadsSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [{ ...thread("thread"), name: "Renamed" }, thread("other")] }),
    );
    expect(surfaces.applyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed");
  });

  it("applies known archive mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActiveThreadsResult(listener);
    catalog.setActiveThreads([thread("thread"), thread("other")]);

    catalog.archiveThreadInCatalog("thread", { closeOpenPanels: true });

    expect(catalog.activeThreadsSnapshot()).toEqual([thread("other")]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("other")] }));
    expect(surfaces.applyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });
});

function catalogFixture(
  options: { fetchThreads?: (context: { codexPath: string; vaultPath: string }) => Promise<readonly Thread[]> } = {},
) {
  const surfaces = surfaceActions();
  const queries = new AppServerSharedQueries({
    cache: cacheWithThreads(options.fetchThreads ?? (() => Promise.resolve([]))),
    context: () => ({ codexPath: "codex", vaultPath: "/vault" }),
  });
  const catalog = new SharedThreadCatalog({
    queries,
    surfaces,
  });
  return { catalog, queries, surfaces };
}

function cacheWithThreads(
  fetchThreads: (context: { codexPath: string; vaultPath: string }) => Promise<readonly Thread[]>,
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

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function surfaceActions(): MockSurfaceActions {
  return {
    refreshOpenViews: vi.fn(),
    invalidateThreadsFromOpenSurface: vi.fn(),
    applyThreadArchived: vi.fn(),
    applyThreadRenamed: vi.fn(),
    refreshThreadsViewLiveState: vi.fn(),
  };
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
  const diagnostics = diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("model/list", "0 models"));
  return {
    runtimeConfig: null,
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    serverDiagnostics: diagnostics,
    ...overrides,
  };
}
