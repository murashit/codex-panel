import { describe, expect, it, vi, type Mock } from "vitest";

import { AppServerQueryCache } from "../../src/app-server/query/cache";
import { AppServerSharedQueries } from "../../src/app-server/query/shared-queries";
import type { Thread } from "../../src/domain/threads/model";
import { createThreadCatalog } from "../../src/workspace/thread-catalog";

interface MockSurfaceActions {
  applyThreadArchived: Mock<(threadId: string, options?: { closeOpenPanels?: boolean }) => void>;
  applyThreadRenamed: Mock<(threadId: string, name: string | null) => void>;
}

describe("ThreadCatalog", () => {
  it("applies thread snapshots to the shared cache and active observers", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread")];
    const listener = vi.fn();
    catalog.observeActive(listener);

    catalog.replaceActiveThreadsSnapshot(threads);

    expect(catalog.activeSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ data: threads }));
  });

  it("refreshes thread snapshots through the cache single-flight and notifies observers once", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([thread("thread")]);
    const { catalog } = catalogFixture({ fetchThreads });
    const listener = vi.fn();
    catalog.observeActive(listener);

    const first = catalog.refreshActive();
    const second = catalog.refreshActive();

    await expect(first).resolves.toEqual([thread("thread")]);
    await expect(second).resolves.toEqual([thread("thread")]);
    expect(fetchThreads).toHaveBeenCalledOnce();
    expect(catalog.activeSnapshot()).toEqual([thread("thread")]);
    expect(listener.mock.calls.filter(([result]) => result.data !== null)).toHaveLength(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("thread")] }));
  });

  it("broadcasts rename mutations to open surfaces after updating the catalog cache", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActive(listener);
    catalog.replaceActiveThreadsSnapshot([thread("thread"), thread("other")]);

    catalog.recordThreadRenamed("thread", "Renamed");

    expect(catalog.activeSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [{ ...thread("thread"), name: "Renamed" }, thread("other")] }),
    );
    expect(surfaces.applyThreadRenamed).toHaveBeenCalledWith("thread", "Renamed");
  });

  it("broadcasts archive mutations to open surfaces after updating catalog membership", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.replaceActiveThreadsSnapshot([thread("thread"), thread("other")]);
    catalog.replaceArchivedThreadsSnapshot([thread("archived", true)]);

    catalog.recordThreadArchived("thread", { closeOpenPanels: true });

    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([{ ...thread("thread"), archived: true }, thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("other")] }));
    expect(archivedListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [{ ...thread("thread"), archived: true }, thread("archived", true)] }),
    );
    expect(surfaces.applyThreadArchived).toHaveBeenCalledWith("thread", { closeOpenPanels: true });
  });

  it("refreshes archived snapshots after unknown archive mutations even when an older archived refresh is in flight", async () => {
    const staleArchivedRefresh = deferred<readonly Thread[]>();
    const secondArchivedRefreshStarted = deferred<undefined>();
    let archivedRefreshCount = 0;
    const fetchThreads = vi.fn((_context: { codexPath: string; vaultPath: string }, archived: boolean) => {
      if (!archived) return Promise.resolve([]);
      archivedRefreshCount += 1;
      if (archivedRefreshCount === 1) return staleArchivedRefresh.promise;
      secondArchivedRefreshStarted.resolve(undefined);
      return Promise.resolve([thread("thread", true)]);
    });
    const { catalog } = catalogFixture({ fetchThreads });

    const staleRefresh = catalog.refreshArchived();
    catalog.recordThreadArchived("thread");

    staleArchivedRefresh.resolve([thread("old", true)]);
    await staleRefresh;
    await secondArchivedRefreshStarted.promise;

    await vi.waitFor(() => {
      expect(catalog.archivedSnapshot()).toEqual([thread("thread", true)]);
    });
    expect(fetchThreads).toHaveBeenCalledTimes(2);
  });

  it("applies known delete mutations to cache without open-surface effects", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.replaceActiveThreadsSnapshot([thread("thread"), thread("other")]);
    catalog.replaceArchivedThreadsSnapshot([thread("thread", true), thread("archived", true)]);

    catalog.recordThreadDeleted("thread");

    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("other")] }));
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("archived", true)] }));
    expect(surfaces.applyThreadArchived).not.toHaveBeenCalled();
    expect(surfaces.applyThreadRenamed).not.toHaveBeenCalled();
  });

  it("records started, forked, and restored thread membership without open-surface broadcasts", () => {
    const { catalog, surfaces } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.replaceActiveThreadsSnapshot([thread("existing")]);
    catalog.replaceArchivedThreadsSnapshot([thread("restored", true), thread("archived", true)]);

    catalog.recordThreadStarted(thread("started"));
    catalog.recordThreadForked(thread("forked"));
    catalog.recordThreadRestored(thread("restored"));

    expect(catalog.activeSnapshot()?.map((item) => item.id)).toEqual(["restored", "forked", "started", "existing"]);
    expect(catalog.archivedSnapshot()?.map((item) => item.id)).toEqual(["archived"]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [thread("restored"), thread("forked"), thread("started"), thread("existing")] }),
    );
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ data: [thread("archived", true)] }));
    expect(surfaces.applyThreadArchived).not.toHaveBeenCalled();
    expect(surfaces.applyThreadRenamed).not.toHaveBeenCalled();
  });
});

function catalogFixture(
  options: { fetchThreads?: (context: { codexPath: string; vaultPath: string }, archived: boolean) => Promise<readonly Thread[]> } = {},
) {
  const surfaces = surfaceActions();
  const queries = new AppServerSharedQueries({
    cache: cacheWithThreads(options.fetchThreads ?? (() => Promise.resolve([]))),
    context: () => ({ codexPath: "codex", vaultPath: "/vault" }),
  });
  const catalog = createThreadCatalog({
    queries,
    surfaces,
  });
  return { catalog, surfaces };
}

function cacheWithThreads(
  fetchThreads: (context: { codexPath: string; vaultPath: string }, archived: boolean) => Promise<readonly Thread[]>,
): AppServerQueryCache {
  return new AppServerQueryCache({
    clientRunner: {
      runWithClient: async (context, operation) => {
        return operation({
          listThreads: async (_cwd: string, options: { archived?: boolean } = {}) => ({
            data: await fetchThreads(context, options.archived ?? false),
            nextCursor: null,
          }),
        } as never);
      },
    },
  });
}

function surfaceActions(): MockSurfaceActions {
  return {
    applyThreadArchived: vi.fn(),
    applyThreadRenamed: vi.fn(),
  };
}

function thread(id: string, archived = false): Thread {
  return {
    id,
    preview: id,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
