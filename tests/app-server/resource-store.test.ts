import { describe, expect, it, vi } from "vitest";

import type { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { AppServerQueryContext } from "../../src/app-server/query/keys";
import { AppServerResourceStore } from "../../src/app-server/query/resource-store";

describe("AppServerResourceStore", () => {
  it("constructs its only query cache from an immutable context", () => {
    const cacheFactory = vi.fn((_context: AppServerQueryContext) => cacheWith());
    const context = { codexPath: "codex-a", vaultPath: "/vault" };

    new AppServerResourceStore({ context, cacheFactory });
    context.codexPath = "changed";

    expect(cacheFactory).toHaveBeenCalledWith({ codexPath: "codex-a", vaultPath: "/vault" });
    expect(Object.isFrozen(cacheFactory.mock.calls[0]?.[0])).toBe(true);
  });

  it("disposes its only query cache once", () => {
    const cache = cacheWith();
    const store = new AppServerResourceStore({
      context: { codexPath: "codex", vaultPath: "/vault" },
      cacheFactory: () => cache,
    });

    store.dispose();
    store.dispose();

    expect(cache.dispose).toHaveBeenCalledOnce();
  });
});

function cacheWith(overrides: Partial<AppServerQueryCache> = {}): AppServerQueryCache {
  return {
    dispose: vi.fn(),
    activeThreadsSnapshot: vi.fn(() => null),
    recentActiveThreadsSnapshot: vi.fn(() => null),
    archivedThreadsSnapshot: vi.fn(() => null),
    fetchActiveThreadSearchInventory: vi.fn(() => Promise.resolve([])),
    fetchActiveThreads: vi.fn(() => Promise.resolve([])),
    hasMoreActiveThreads: vi.fn(() => false),
    loadMoreActiveThreads: vi.fn(() => Promise.resolve([])),
    refreshActiveThreads: vi.fn(() => Promise.resolve([])),
    refreshArchivedThreads: vi.fn(() => Promise.resolve([])),
    observeActiveThreadsResult: vi.fn(() => () => undefined),
    observeArchivedThreadsResult: vi.fn(() => () => undefined),
    appServerMetadataSnapshot: vi.fn(() => null),
    refreshAppServerMetadata: vi.fn(() => Promise.resolve()),
    refreshSkills: vi.fn(() => Promise.resolve()),
    refreshRateLimits: vi.fn(() => Promise.resolve()),
    observeAppServerMetadataResources: vi.fn(() => () => undefined),
    modelsSnapshot: vi.fn(() => null),
    fetchModels: vi.fn(() => Promise.resolve([])),
    refreshModels: vi.fn(() => Promise.resolve([])),
    observeModelsResult: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as AppServerQueryCache;
}
