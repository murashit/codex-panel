import { describe, expect, it, vi, type Mock } from "vitest";

import { SharedAppServerCache } from "../../src/app-server/services/shared-cache";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { createServerDiagnostics } from "../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../src/domain/server/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { SharedThreadCatalog } from "../../src/workspace/shared-thread-catalog";
import type { ThreadSurfaceActions } from "../../src/workspace/thread-surface-actions";

type MockSurfaceActions = ThreadSurfaceActions & {
  applyThreadListSnapshot: Mock<(threads: readonly Thread[]) => void>;
  applyThreadArchived: Mock<(threadId: string, options?: { closeOpenPanels?: boolean }) => void>;
  applyThreadRenamed: Mock<(threadId: string, name: string | null) => void>;
  publishAppServerMetadata: Mock<(metadata: SharedServerMetadata) => void>;
  publishModels: Mock<(models: readonly ModelMetadata[]) => void>;
};

describe("SharedThreadCatalog", () => {
  it("applies thread snapshots to the shared cache and open surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const threads = [thread("thread")];

    catalog.applyThreads(threads);

    expect(catalog.cachedThreads()).toEqual(threads);
    expect(surfaces.applyThreadListSnapshot).toHaveBeenCalledWith(threads);
  });

  it("refreshes thread snapshots through the cache single-flight and publishes the snapshot once", async () => {
    const { catalog, surfaces } = catalogFixture();
    const fetchThreads = vi.fn().mockResolvedValue([thread("thread")]);

    const first = catalog.refreshThreads(fetchThreads);
    const second = catalog.refreshThreads(fetchThreads);

    await expect(first).resolves.toEqual([thread("thread")]);
    await expect(second).resolves.toEqual([thread("thread")]);
    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(catalog.cachedThreads()).toEqual([thread("thread")]);
    expect(surfaces.applyThreadListSnapshot).toHaveBeenCalledOnce();
  });

  it("publishes metadata and model snapshots to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    const metadata = serverMetadata({ availableModels: [model("gpt-test")] });
    const models = [model("gpt-other")];

    catalog.publishAppServerMetadata(metadata);
    catalog.publishModels(models);

    expect(catalog.cachedAppServerMetadata()).toEqual({ ...metadata, availableModels: models });
    expect(catalog.cachedModels()).toEqual(models);
    expect(surfaces.publishAppServerMetadata).toHaveBeenCalledWith(metadata);
    expect(surfaces.publishModels).toHaveBeenCalledWith(models);
  });

  it("applies known rename mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    catalog.applyThreads([thread("thread"), thread("other")]);

    catalog.renameThreadInCatalog("thread", "Renamed");

    expect(catalog.cachedThreads()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(surfaces.applyThreadListSnapshot).toHaveBeenLastCalledWith([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(surfaces.applyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed");
  });

  it("applies known archive mutations to cache and surfaces", () => {
    const { catalog, surfaces } = catalogFixture();
    catalog.applyThreads([thread("thread"), thread("other")]);

    catalog.archiveThreadInCatalog("thread", { closeOpenPanels: true });

    expect(catalog.cachedThreads()).toEqual([thread("other")]);
    expect(surfaces.applyThreadListSnapshot).toHaveBeenLastCalledWith([thread("other")]);
    expect(surfaces.applyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });
});

function catalogFixture() {
  const surfaces = surfaceActions();
  const catalog = new SharedThreadCatalog({
    cache: new SharedAppServerCache(),
    surfaces,
    context: () => ({ codexPath: "codex", vaultPath: "/vault" }),
  });
  return { catalog, surfaces };
}

function surfaceActions(): MockSurfaceActions {
  return {
    refreshOpenViews: vi.fn(),
    invalidateThreadsFromOpenSurface: vi.fn(),
    applyThreadListSnapshot: vi.fn(),
    applyThreadArchived: vi.fn(),
    applyThreadRenamed: vi.fn(),
    publishAppServerMetadata: vi.fn(),
    publishModels: vi.fn(),
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
