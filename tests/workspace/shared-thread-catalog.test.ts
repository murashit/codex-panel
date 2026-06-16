import { describe, expect, it, vi, type Mock } from "vitest";

import { AppServerQueryCache } from "../../src/app-server/query/cache";
import { AppServerSharedQueries } from "../../src/app-server/query/shared-queries";
import type { Thread } from "../../src/domain/threads/model";
import { createSharedThreadCatalog } from "../../src/workspace/shared-thread-catalog";

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
  const catalog = createSharedThreadCatalog({
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
