import { describe, expect, it, vi, type Mock } from "vitest";

import { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { createServerDiagnostics } from "../../src/domain/server/diagnostics";
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
    catalog.observeActiveThreads(listener);

    catalog.setActiveThreads(threads);

    expect(catalog.activeThreadsSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(threads);
  });

  it("refreshes thread snapshots through the cache single-flight and notifies observers once", async () => {
    const { catalog } = catalogFixture();
    const fetchThreads = vi.fn().mockResolvedValue([thread("thread")]);
    const listener = vi.fn();
    catalog.observeActiveThreads(listener);

    const first = catalog.fetchActiveThreads(fetchThreads);
    const second = catalog.fetchActiveThreads(fetchThreads);

    await expect(first).resolves.toEqual([thread("thread")]);
    await expect(second).resolves.toEqual([thread("thread")]);
    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(catalog.activeThreadsSnapshot()).toEqual([thread("thread")]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify stale thread observers after the app-server query context changes", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const surfaces = surfaceActions();
    const catalog = new SharedThreadCatalog({
      cache: new AppServerQueryCache(),
      surfaces,
      context: () => context,
    });
    let resolveThreads!: (threads: Thread[]) => void;
    const listener = vi.fn();
    catalog.observeActiveThreads(listener);

    const fetch = catalog.fetchActiveThreads(
      () =>
        new Promise<Thread[]>((resolve) => {
          resolveThreads = resolve;
        }),
    );
    context.codexPath = "codex-b";
    resolveThreads([thread("stale")]);

    await expect(fetch).resolves.toEqual([thread("stale")]);
    expect(listener).not.toHaveBeenCalled();
    context.codexPath = "codex-a";
    expect(catalog.activeThreadsSnapshot()).toEqual([thread("stale")]);
  });

  it("resubscribes active observers when the app-server query context changes", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const catalog = new SharedThreadCatalog({
      cache: new AppServerQueryCache(),
      surfaces: surfaceActions(),
      context: () => context,
    });
    const listener = vi.fn();
    catalog.observeActiveThreads(listener);

    catalog.setActiveThreads([thread("a")]);
    context.codexPath = "codex-b";
    catalog.notifyAppServerQueryContextChanged();
    catalog.setActiveThreads([thread("b")]);

    expect(listener).toHaveBeenLastCalledWith([thread("b")]);
    context.codexPath = "codex-a";
    catalog.notifyAppServerQueryContextChanged();
    expect(listener).toHaveBeenLastCalledWith([thread("a")]);
  });

  it("publishes metadata and model snapshots to cache and observers", () => {
    const { catalog } = catalogFixture();
    const metadata = serverMetadata({ availableModels: [model("gpt-test")] });
    const models = [model("gpt-other")];
    const metadataListener = vi.fn();
    const modelListener = vi.fn();
    catalog.observeAppServerMetadata(metadataListener);
    catalog.observeModels(modelListener);

    catalog.setAppServerMetadata(metadata);
    catalog.setModels(models);

    expect(catalog.appServerMetadataSnapshot()).toEqual({ ...metadata, availableModels: models });
    expect(catalog.modelsSnapshot()).toEqual(models);
    expect(metadataListener).toHaveBeenLastCalledWith({ ...metadata, availableModels: models });
    expect(modelListener).toHaveBeenCalledWith(models);
  });

  it("applies known rename mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActiveThreads(listener);
    catalog.setActiveThreads([thread("thread"), thread("other")]);

    catalog.renameThreadInCatalog("thread", "Renamed");

    expect(catalog.activeThreadsSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(listener).toHaveBeenLastCalledWith([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(surfaces.applyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed");
  });

  it("applies known archive mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActiveThreads(listener);
    catalog.setActiveThreads([thread("thread"), thread("other")]);

    catalog.archiveThreadInCatalog("thread", { closeOpenPanels: true });

    expect(catalog.activeThreadsSnapshot()).toEqual([thread("other")]);
    expect(listener).toHaveBeenLastCalledWith([thread("other")]);
    expect(surfaces.applyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });
});

function catalogFixture() {
  const surfaces = surfaceActions();
  const catalog = new SharedThreadCatalog({
    cache: new AppServerQueryCache(),
    surfaces,
    context: () => ({ codexPath: "codex", vaultPath: "/vault" }),
  });
  return { catalog, surfaces };
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
  return {
    runtimeConfig: null,
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    serverDiagnostics: createServerDiagnostics(),
    ...overrides,
  };
}
