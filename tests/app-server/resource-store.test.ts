import { describe, expect, it, vi } from "vitest";

import type { AppServerQueryCache } from "../../src/app-server/query/cache";
import type { AppServerQueryContextIdentity } from "../../src/app-server/query/keys";
import type { ObservedResult } from "../../src/app-server/query/observed-result";
import { AppServerResourceStore, StaleAppServerResourceContextError } from "../../src/app-server/query/resource-store";
import type { Thread } from "../../src/domain/threads/model";
import { deferred } from "../support/async";

describe("AppServerResourceStore", () => {
  it("requires explicit initialization and freezes the active context lease", () => {
    const store = new AppServerResourceStore({ cache: cacheWith() });

    expect(() => store.contextLease()).toThrow("not initialized");
    const lease = store.initialize({ codexPath: "codex-a", vaultPath: "/vault" });

    expect(lease).toEqual({ context: { codexPath: "codex-a", vaultPath: "/vault" }, generation: 1 });
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.isFrozen(lease.context)).toBe(true);
    expect(() => store.initialize({ codexPath: "codex-b", vaultPath: "/vault" })).toThrow("already initialized");
  });

  it("keeps the same lease and cache coordination when replacement receives the same raw context", async () => {
    const pending = deferred<readonly Thread[]>();
    const refreshActiveThreads = vi.fn(() => pending.promise);
    const cache = cacheWith({ refreshActiveThreads });
    const store = new AppServerResourceStore({ cache });
    const firstLease = store.initialize({ codexPath: "codex-a", vaultPath: "/vault" });

    const refresh = store.refreshActiveThreads();
    const secondLease = store.replaceContext({ codexPath: "codex-a", vaultPath: "/vault" });
    pending.resolve([thread("same-lease")]);

    expect(secondLease).toBe(firstLease);
    await expect(refresh).resolves.toEqual([thread("same-lease")]);
    expect(cache.release).not.toHaveBeenCalled();
  });

  it("rejects an A1 result after A to B to A replacement and never reuses a generation", async () => {
    const pending = deferred<readonly Thread[]>();
    const identities: AppServerQueryContextIdentity[] = [];
    const cache = cacheWith({
      refreshActiveThreads: vi.fn((identity: AppServerQueryContextIdentity) => {
        identities.push(identity);
        return pending.promise;
      }),
    });
    const store = new AppServerResourceStore({ cache });
    const firstA = store.initialize({ codexPath: "codex-a", vaultPath: "/vault" });

    const refresh = store.refreshActiveThreads();
    const b = store.replaceContext({ codexPath: "codex-b", vaultPath: "/vault" });
    const secondA = store.replaceContext({ codexPath: "codex-a", vaultPath: "/vault" });
    pending.resolve([thread("stale-a")]);

    await expect(refresh).rejects.toBeInstanceOf(StaleAppServerResourceContextError);
    expect([firstA.generation, b.generation, secondA.generation]).toEqual([1, 2, 3]);
    expect(identities).toEqual([{ codexPath: "codex-a", vaultPath: "/vault", generation: 1 }]);
  });

  it("rebinds observers by generation and ignores events from an earlier identical raw context", () => {
    const listeners = new Map<number, (result: ObservedResult<readonly Thread[]>) => void>();
    const unsubscribers = new Map<number, ReturnType<typeof vi.fn>>();
    const store = new AppServerResourceStore({
      cache: cacheWith({
        observeActiveThreadsResult: (identity, listener) => {
          listeners.set(identity.generation, listener);
          const unsubscribe = vi.fn();
          unsubscribers.set(identity.generation, unsubscribe);
          return unsubscribe;
        },
      }),
    });
    store.initialize({ codexPath: "codex-a", vaultPath: "/vault" });
    const listener = vi.fn();
    store.observeActiveThreadsResult(listener);

    store.replaceContext({ codexPath: "codex-b", vaultPath: "/vault" });
    store.replaceContext({ codexPath: "codex-a", vaultPath: "/vault" });
    listeners.get(1)?.(observedResult([thread("stale-a")]));
    listeners.get(3)?.(observedResult([thread("current-a")]));

    expect(unsubscribers.get(1)).toHaveBeenCalledOnce();
    expect(unsubscribers.get(2)).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ value: [thread("current-a")] }));
  });

  it("does not reuse a lease generation after reset", () => {
    const store = new AppServerResourceStore({ cache: cacheWith() });
    expect(store.initialize({ codexPath: "codex", vaultPath: "/vault" }).generation).toBe(1);

    store.reset();

    expect(store.initialize({ codexPath: "codex", vaultPath: "/vault" }).generation).toBe(2);
  });
});

function cacheWith(overrides: Partial<AppServerQueryCache> = {}): AppServerQueryCache {
  return {
    clear: vi.fn(),
    release: vi.fn(),
    activeThreadsSnapshot: vi.fn(() => null),
    archivedThreadsSnapshot: vi.fn(() => null),
    fetchAllActiveThreads: vi.fn(() => Promise.resolve([])),
    hasMoreActiveThreads: vi.fn(() => false),
    loadMoreActiveThreads: vi.fn(() => Promise.resolve([])),
    refreshActiveThreads: vi.fn(() => Promise.resolve([])),
    refreshArchivedThreads: vi.fn(() => Promise.resolve([])),
    observeActiveThreadsResult: vi.fn(() => () => undefined),
    observeArchivedThreadsResult: vi.fn(() => () => undefined),
    appServerMetadataSnapshot: vi.fn(() => null),
    refreshAppServerMetadata: vi.fn(() => Promise.resolve(null)),
    refreshSkills: vi.fn(() => Promise.resolve(null)),
    refreshRateLimits: vi.fn(() => Promise.resolve(null)),
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
    provenance: { kind: "interactive" },
  };
}
