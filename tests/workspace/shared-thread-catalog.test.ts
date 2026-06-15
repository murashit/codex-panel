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
  publishAppServerMetadata: Mock<(metadata: SharedServerMetadata) => void>;
  publishModels: Mock<(models: readonly ModelMetadata[]) => void>;
  notifyThreadArchived: Mock<(threadId: string, options?: { closeOpenPanels?: boolean }) => void>;
  notifyThreadRenamed: Mock<(threadId: string, name: string | null) => void>;
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

  it("forwards archive and rename notifications through the surface owner", () => {
    const { catalog, surfaces } = catalogFixture();

    catalog.notifyThreadArchived("thread", { closeOpenPanels: true });
    catalog.notifyThreadRenamed("thread", "Renamed");

    expect(surfaces.notifyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
    expect(surfaces.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed");
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
    refreshSharedThreadListFromOpenSurface: vi.fn(),
    applyThreadListSnapshot: vi.fn(),
    publishAppServerMetadata: vi.fn(),
    publishModels: vi.fn(),
    refreshThreadsViewLiveState: vi.fn(),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
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
