import { describe, expect, it, type Mock, vi } from "vitest";

import { AppServerQueryCache } from "../../src/app-server/query/cache";
import { AppServerSharedQueries } from "../../src/app-server/query/shared-queries";
import { createThreadCatalog, type ThreadCatalogEventObserver } from "../../src/app-server/query/thread-catalog";
import type { Thread } from "../../src/domain/threads/model";

describe("ThreadCatalog", () => {
  it("applies active thread snapshot replacement events through the catalog boundary", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread")];
    const listener = vi.fn();
    catalog.observeActive(listener);

    catalog.apply({ type: "active-list-snapshot-received", threads });

    expect(catalog.activeSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ value: threads }));
  });

  it("applies archived thread snapshot events through the catalog boundary", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread", true)];
    const listener = vi.fn();
    catalog.observeArchived(listener);

    catalog.apply({ type: "archived-list-snapshot-received", threads });

    expect(catalog.archivedSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ value: threads }));
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
    expect(listener.mock.calls.filter(([result]) => result.value !== null)).toHaveLength(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("thread")] }));
  });

  it("notifies applied catalog events through a generic observer", () => {
    const onEventApplied = vi.fn();
    const { catalog } = catalogFixture({ onEventApplied });

    catalog.apply({ type: "thread-started", thread: thread("thread") });

    expect(onEventApplied).toHaveBeenCalledWith({ type: "thread-started", thread: thread("thread") });
  });

  it("applies rename mutations after updating the catalog cache", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActive(listener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("thread"), thread("other")] });

    catalog.apply({ type: "thread-renamed", threadId: "thread", name: "Renamed" });

    expect(catalog.activeSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: [{ ...thread("thread"), name: "Renamed" }, thread("other")] }),
    );
  });

  it("applies archive mutations after updating catalog membership", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("thread"), thread("other")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("archived", true)] });

    catalog.apply({ type: "thread-archived", threadId: "thread", options: { closeOpenPanels: true } });

    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([{ ...thread("thread"), archived: true }, thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("other")] }));
    expect(archivedListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: [{ ...thread("thread"), archived: true }, thread("archived", true)] }),
    );
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
    catalog.apply({ type: "thread-archived", threadId: "thread" });

    staleArchivedRefresh.resolve([thread("old", true)]);
    await staleRefresh;
    await secondArchivedRefreshStarted.promise;

    await vi.waitFor(() => {
      expect(catalog.archivedSnapshot()).toEqual([thread("thread", true)]);
    });
    expect(fetchThreads).toHaveBeenCalledTimes(2);
  });

  it("applies known delete mutations to cache", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("thread"), thread("other")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("thread", true), thread("archived", true)] });

    catalog.apply({ type: "thread-deleted", threadId: "thread" });

    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("other")] }));
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("archived", true)] }));
  });

  it("records started, forked, and restored thread membership", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("existing")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("restored", true), thread("archived", true)] });

    catalog.apply({ type: "thread-started", thread: thread("started") });
    catalog.apply({ type: "thread-forked", thread: thread("forked") });
    catalog.apply({ type: "thread-restored", thread: thread("restored") });

    expect(catalog.activeSnapshot()?.map((item) => item.id)).toEqual(["restored", "forked", "started", "existing"]);
    expect(catalog.archivedSnapshot()?.map((item) => item.id)).toEqual(["archived"]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: [thread("restored"), thread("forked"), thread("started"), thread("existing")] }),
    );
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("archived", true)] }));
  });

  it("keeps app-server lifecycle threads visible until the server list acknowledges them", async () => {
    const fetchThreads = vi
      .fn()
      .mockResolvedValueOnce([thread("other")])
      .mockResolvedValueOnce([thread("started"), thread("other")])
      .mockResolvedValueOnce([thread("other")]);
    const { catalog } = catalogFixture({ fetchThreads });
    const listener = vi.fn();
    catalog.observeActive(listener);

    catalog.apply({ type: "thread-started", thread: thread("started") });

    await expect(catalog.refreshActive()).resolves.toEqual([thread("started"), thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([thread("started"), thread("other")]);
    expect(observedActiveThreadIds(listener)).not.toContainEqual(["other"]);

    await expect(catalog.refreshActive()).resolves.toEqual([thread("started"), thread("other")]);
    await expect(catalog.refreshActive()).resolves.toEqual([thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
  });

  it("scopes pending lifecycle facts by app-server query context", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog } = catalogFixture({ context: () => context });

    catalog.apply({ type: "thread-started", thread: thread("started-a") });
    expect(catalog.activeSnapshot()).toEqual([thread("started-a")]);

    context.codexPath = "codex-b";
    expect(catalog.activeSnapshot()).toBeNull();
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("thread-b")] });
    expect(catalog.activeSnapshot()).toEqual([thread("thread-b")]);

    context.codexPath = "codex-a";
    expect(catalog.activeSnapshot()).toEqual([thread("started-a")]);
  });

  it("keeps rollback fork metadata until active snapshots catch up to the rollback version", () => {
    const { catalog } = catalogFixture();
    const forkBeforeRollback = thread("forked", false, { name: "Before", preview: "Before rollback", updatedAt: 20 });
    const forkAfterRollback = thread("forked", false, { name: "After", preview: "After rollback", updatedAt: 20 });
    const forkAfterFutureUpdate = thread("forked", false, { name: "Future", preview: "Future update", updatedAt: 21 });
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("existing")] });

    catalog.apply({ type: "thread-forked", thread: forkAfterRollback });
    catalog.apply({ type: "active-list-snapshot-received", threads: [forkBeforeRollback, thread("existing")] });

    expect(catalog.activeSnapshot()).toEqual([forkAfterRollback, thread("existing")]);

    catalog.apply({ type: "active-list-snapshot-received", threads: [forkAfterFutureUpdate, thread("existing")] });

    expect(catalog.activeSnapshot()).toEqual([forkAfterFutureUpdate, thread("existing")]);
  });

  it("keeps app-server rename facts when an older active list resolves later", async () => {
    const staleRefresh = deferred<readonly Thread[]>();
    const fetchThreads = vi
      .fn()
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    const { catalog } = catalogFixture({ fetchThreads });
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("thread"), thread("other")] });

    const refresh = catalog.refreshActive();
    await flushMicrotasks();
    catalog.apply({ type: "thread-renamed", threadId: "thread", name: "Renamed" });
    staleRefresh.resolve([thread("thread"), thread("other")]);

    await expect(refresh).resolves.toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);

    await expect(catalog.refreshActive()).resolves.toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
  });

  it("keeps app-server removal facts when older active and archived lists resolve later", async () => {
    const staleActiveRefresh = deferred<readonly Thread[]>();
    const staleArchivedRefresh = deferred<readonly Thread[]>();
    const fetchThreads = vi.fn((_context: { codexPath: string; vaultPath: string }, archived: boolean) =>
      archived ? staleArchivedRefresh.promise : staleActiveRefresh.promise,
    );
    const { catalog } = catalogFixture({ fetchThreads });
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("active"), thread("other")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("archived", true), thread("kept", true)] });

    const activeRefresh = catalog.refreshActive();
    const archivedRefresh = catalog.refreshArchived();
    await flushMicrotasks();

    catalog.apply({ type: "thread-archived", threadId: "active" });
    catalog.apply({ type: "thread-deleted", threadId: "archived" });
    staleActiveRefresh.resolve([thread("active"), thread("other")]);
    staleArchivedRefresh.resolve([thread("archived", true), thread("kept", true)]);

    await expect(activeRefresh).resolves.toEqual([thread("other")]);
    await expect(archivedRefresh).resolves.toEqual([thread("active", true), thread("kept", true)]);
    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([thread("active", true), thread("kept", true)]);
  });

  it("archives unacknowledged active lifecycle threads without waiting for list acknowledgement", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([thread("other")]);
    const { catalog } = catalogFixture({ fetchThreads });
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);

    catalog.apply({ type: "thread-started", thread: thread("started") });
    catalog.apply({ type: "thread-archived", threadId: "started" });

    expect(catalog.activeSnapshot()).toEqual([]);
    expect(catalog.archivedSnapshot()).toEqual([thread("started", true)]);
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("started", true)] }));

    await expect(catalog.refreshActive()).resolves.toEqual([thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(observedActiveThreadIds(listener)).not.toContainEqual(["started", "other"]);
  });

  it("deletes unacknowledged active lifecycle threads", async () => {
    const fetchThreads = vi.fn().mockResolvedValue([thread("other")]);
    const { catalog } = catalogFixture({ fetchThreads });
    catalog.apply({ type: "thread-started", thread: thread("started") });

    catalog.apply({ type: "thread-deleted", threadId: "started" });

    expect(catalog.activeSnapshot()).toEqual([]);
    expect(catalog.archivedSnapshot()).toEqual([]);
    await expect(catalog.refreshActive()).resolves.toEqual([thread("other")]);
    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
  });

  it("records active thread touches as catalog ordering facts", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    catalog.observeActive(listener);
    catalog.apply({
      type: "active-list-snapshot-received",
      threads: [thread("active", false, { updatedAt: 1, recencyAt: 1 }), thread("other", false, { updatedAt: 10, recencyAt: 10 })],
    });

    catalog.apply({ type: "thread-touched", threadId: "active", recencyAt: 20 });

    expect(catalog.activeSnapshot()).toEqual([
      thread("active", false, { updatedAt: 1, recencyAt: 20 }),
      thread("other", false, { updatedAt: 10, recencyAt: 10 }),
    ]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        value: [thread("active", false, { updatedAt: 1, recencyAt: 20 }), thread("other", false, { updatedAt: 10, recencyAt: 10 })],
      }),
    );
  });

  it("applies thread lifecycle events through one catalog event boundary", () => {
    const { catalog } = catalogFixture();
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("existing")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("archived", true)] });

    catalog.apply({ type: "thread-started", thread: thread("started") });
    catalog.apply({ type: "thread-touched", threadId: "existing", recencyAt: 20 });
    catalog.apply({ type: "thread-renamed", threadId: "started", name: "Started" });
    catalog.apply({ type: "thread-archived", threadId: "existing", options: { closeOpenPanels: true } });

    expect(catalog.activeSnapshot()).toEqual([{ ...thread("started"), name: "Started" }]);
    expect(catalog.archivedSnapshot()).toEqual([thread("existing", true, { recencyAt: 20 }), thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [{ ...thread("started"), name: "Started" }] }));
    expect(archivedListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: [thread("existing", true, { recencyAt: 20 }), thread("archived", true)] }),
    );
  });

  it("moves known unarchived threads through the catalog and refreshes unknown unarchives", async () => {
    const unknownActiveRefreshStarted = deferred<undefined>();
    const unknownArchivedRefreshStarted = deferred<undefined>();
    const fetchThreads = vi.fn((_context: { codexPath: string; vaultPath: string }, archived: boolean) => {
      if (archived) {
        unknownArchivedRefreshStarted.resolve(undefined);
        return Promise.resolve([]);
      }
      unknownActiveRefreshStarted.resolve(undefined);
      return Promise.resolve([thread("unknown")]);
    });
    const { catalog } = catalogFixture({ fetchThreads });
    const listener = vi.fn();
    const archivedListener = vi.fn();
    catalog.observeActive(listener);
    catalog.observeArchived(archivedListener);
    catalog.apply({ type: "active-list-snapshot-received", threads: [thread("active")] });
    catalog.apply({ type: "archived-list-snapshot-received", threads: [thread("known", true)] });

    catalog.apply({ type: "thread-unarchived", threadId: "known" });

    expect(catalog.activeSnapshot()).toEqual([thread("known"), thread("active")]);
    expect(catalog.archivedSnapshot()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [thread("known"), thread("active")] }));
    expect(archivedListener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [] }));

    catalog.apply({ type: "thread-unarchived", threadId: "unknown" });

    await unknownActiveRefreshStarted.promise;
    await unknownArchivedRefreshStarted.promise;
    await vi.waitFor(() => {
      expect(catalog.activeSnapshot()).toEqual([thread("known"), thread("unknown")]);
    });
    expect(fetchThreads).toHaveBeenCalledTimes(2);
  });
});

function catalogFixture(
  options: {
    fetchThreads?: (context: { codexPath: string; vaultPath: string }, archived: boolean) => Promise<readonly Thread[]>;
    context?: () => { codexPath: string; vaultPath: string };
    onEventApplied?: ThreadCatalogEventObserver;
  } = {},
) {
  const store = new AppServerSharedQueries({
    cache: cacheWithThreads(options.fetchThreads ?? (() => Promise.resolve([]))),
    context: options.context ?? (() => ({ codexPath: "codex", vaultPath: "/vault" })),
  });
  const catalog = createThreadCatalog(
    options.onEventApplied
      ? {
          store,
          onEventApplied: options.onEventApplied,
        }
      : { store },
  );
  return { catalog };
}

function cacheWithThreads(
  fetchThreads: (context: { codexPath: string; vaultPath: string }, archived: boolean) => Promise<readonly Thread[]>,
): AppServerQueryCache {
  return new AppServerQueryCache({
    clientRunner: {
      runWithClient: async (context, operation) => {
        return operation({
          request: async (method: string, params: { archived?: boolean } = {}) => {
            if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
            return {
              data: await fetchThreads(context, params.archived ?? false),
              nextCursor: null,
            };
          },
        } as never);
      },
    },
  });
}

function observedActiveThreadIds(listener: Mock): string[][] {
  return listener.mock.calls
    .map((call) => {
      const result = call[0] as { value: readonly Thread[] | null };
      return result.value?.map((item) => item.id) ?? null;
    })
    .filter((ids): ids is string[] => ids !== null);
}

function thread(id: string, archived = false, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: id,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived,
    ...overrides,
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

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
