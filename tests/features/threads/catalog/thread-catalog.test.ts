import { describe, expect, it, type Mock, vi } from "vitest";

import { AppServerQueryCache } from "../../../../src/app-server/query/cache";
import { type AppServerQueryContext, appServerQueryContextKey } from "../../../../src/app-server/query/keys";
import type { ObservedResult, ObservedResultListener } from "../../../../src/app-server/query/observed-result";
import { AppServerSharedQueries } from "../../../../src/app-server/query/shared-queries";
import type { Thread } from "../../../../src/domain/threads/model";
import {
  createThreadCatalog,
  type ThreadCatalog,
  type ThreadCatalogEventObserver,
} from "../../../../src/features/threads/catalog/thread-catalog";

describe("ThreadCatalog", () => {
  it("projects active snapshots received from the store observer", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread")];
    const listener = vi.fn();
    catalog.observeActive(listener);

    receiveActive(catalog, threads);

    expect(catalog.activeSnapshot()).toEqual(threads);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ value: threads }));
  });

  it("projects archived snapshots received from the store observer", () => {
    const { catalog } = catalogFixture();
    const threads = [thread("thread", true)];
    const listener = vi.fn();
    catalog.observeArchived(listener);

    receiveArchived(catalog, threads);

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
    receiveActive(catalog, [thread("thread"), thread("other")]);

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
    receiveActive(catalog, [thread("thread"), thread("other")]);
    receiveArchived(catalog, [thread("archived", true)]);

    catalog.apply({ type: "thread-archived", threadId: "thread" });

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
    receiveActive(catalog, [thread("thread"), thread("other")]);
    receiveArchived(catalog, [thread("thread", true), thread("archived", true)]);

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
    receiveActive(catalog, [thread("existing")]);
    receiveArchived(catalog, [thread("restored", true), thread("archived", true)]);

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
    receiveActive(catalog, [thread("thread-b")]);
    expect(catalog.activeSnapshot()).toEqual([thread("thread-b")]);

    context.codexPath = "codex-a";
    expect(catalog.activeSnapshot()).toEqual([thread("started-a")]);
  });

  it("applies a connection event to its captured context after the current context changes", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog } = catalogFixture({ context: () => context });
    const connectionContext = { ...context };

    context.codexPath = "codex-b";
    catalog.applyConnectionEvent(connectionContext, { type: "thread-started", thread: thread("started-a") });

    expect(catalog.activeSnapshot()).toBeNull();
    context.codexPath = "codex-a";
    expect(catalog.activeSnapshot()).toEqual([thread("started-a")]);
  });

  it("reads captured-context snapshots when applying connection events", async () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const connectionContext = { ...context };
    const { catalog } = catalogFixture({
      context: () => context,
      fetchThreads: (source) => Promise.resolve(source.codexPath === "codex-a" ? [thread("thread-a")] : []),
    });
    await catalog.refreshActive();

    context.codexPath = "codex-b";
    catalog.applyConnectionEvent(connectionContext, { type: "thread-renamed", threadId: "thread-a", name: "Renamed A" });

    expect(catalog.activeSnapshot()).toBeNull();
    context.codexPath = "codex-a";
    expect(catalog.activeSnapshot()).toEqual([thread("thread-a", false, { name: "Renamed A" })]);
  });

  it("clears pending lifecycle facts across every app-server query context", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog, cache } = catalogFixture({ context: () => context });
    catalog.apply({ type: "thread-started", thread: thread("started-a") });
    context.codexPath = "codex-b";
    catalog.apply({ type: "thread-started", thread: thread("started-b") });

    cache.clear();
    catalog.clear();

    expect(catalog.activeSnapshot()).toBeNull();
    context.codexPath = "codex-a";
    expect(catalog.activeSnapshot()).toBeNull();
  });

  it("retains unacknowledged lifecycle facts across connection contexts", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog } = catalogFixture({ context: () => context });
    catalog.apply({ type: "thread-started", thread: thread("started-a") });

    for (const suffix of ["b", "c", "d", "e"]) {
      context.codexPath = `codex-${suffix}`;
      catalog.activeSnapshot();
    }

    context.codexPath = "codex-a";
    receiveActive(catalog, [thread("server-a")]);

    expect(catalog.activeSnapshot()).toEqual([thread("started-a"), thread("server-a")]);
  });

  it("prunes inactive lifecycle facts without discarding store snapshots", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog } = catalogFixture({ context: () => context });
    receiveActive(catalog, [thread("server-a")]);

    context.codexPath = "codex-b";
    expect(catalog.activeSnapshot()).toBeNull();
    context.codexPath = "codex-a";

    expect(catalog.activeSnapshot()).toEqual([thread("server-a")]);
  });

  it("prunes revisited contexts after pending lifecycle facts settle", () => {
    const context = { codexPath: "codex-a", vaultPath: "/vault" };
    const { catalog } = catalogFixture({ context: () => context });
    catalog.apply({ type: "thread-started", thread: thread("started-a") });
    context.codexPath = "codex-b";
    catalog.apply({ type: "thread-started", thread: thread("started-b") });

    context.codexPath = "codex-a";
    receiveActive(catalog, [thread("started-a")]);
    context.codexPath = "codex-b";
    receiveActive(catalog, [thread("started-b")]);
    context.codexPath = "codex-a";

    expect(catalog.activeSnapshot()).toEqual([thread("started-a")]);
  });

  it("preserves raw query status when lifecycle overlays publish", async () => {
    const refresh = deferred<readonly Thread[]>();
    const { catalog } = catalogFixture({ fetchThreads: () => refresh.promise });
    const listener = vi.fn();
    catalog.observeActive(listener);
    const refreshing = catalog.refreshActive();
    await flushMicrotasks();

    catalog.apply({ type: "thread-started", thread: thread("started") });

    expect(listener).toHaveBeenLastCalledWith({ value: [thread("started")], error: null, isFetching: true });
    refresh.resolve([]);
    await refreshing;
  });

  it("keeps rollback fork metadata until active snapshots catch up to the rollback version", () => {
    const { catalog } = catalogFixture();
    const forkBeforeRollback = thread("forked", false, { name: "Before", preview: "Before rollback", updatedAt: 20 });
    const forkAfterRollback = thread("forked", false, { name: "After", preview: "After rollback", updatedAt: 20 });
    const forkAfterFutureUpdate = thread("forked", false, { name: "Future", preview: "Future update", updatedAt: 21 });
    receiveActive(catalog, [thread("existing")]);

    catalog.apply({ type: "thread-forked", thread: forkAfterRollback });
    receiveActive(catalog, [forkBeforeRollback, thread("existing")]);

    expect(catalog.activeSnapshot()).toEqual([forkAfterRollback, thread("existing")]);

    receiveActive(catalog, [forkAfterFutureUpdate, thread("existing")]);

    expect(catalog.activeSnapshot()).toEqual([forkAfterFutureUpdate, thread("existing")]);
  });

  it("keeps app-server rename facts when an older active list resolves later", async () => {
    const staleRefresh = deferred<readonly Thread[]>();
    const fetchThreads = vi
      .fn()
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce([{ ...thread("thread"), name: "Renamed" }, thread("other")]);
    const { catalog } = catalogFixture({ fetchThreads });
    receiveActive(catalog, [thread("thread"), thread("other")]);

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
    receiveActive(catalog, [thread("active"), thread("other")]);
    receiveArchived(catalog, [thread("archived", true), thread("kept", true)]);

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
    receiveActive(catalog, [
      thread("active", false, { updatedAt: 1, recencyAt: 1 }),
      thread("other", false, { updatedAt: 10, recencyAt: 10 }),
    ]);

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
    receiveActive(catalog, [thread("existing")]);
    receiveArchived(catalog, [thread("archived", true)]);

    catalog.apply({ type: "thread-started", thread: thread("started") });
    catalog.apply({ type: "thread-touched", threadId: "existing", recencyAt: 20 });
    catalog.apply({ type: "thread-renamed", threadId: "started", name: "Started" });
    catalog.apply({ type: "thread-archived", threadId: "existing" });

    expect(catalog.activeSnapshot()).toEqual([{ ...thread("started"), name: "Started" }]);
    expect(catalog.archivedSnapshot()).toEqual([thread("existing", true, { recencyAt: 20 }), thread("archived", true)]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ value: [{ ...thread("started"), name: "Started" }] }));
    expect(archivedListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: [thread("existing", true, { recencyAt: 20 }), thread("archived", true)] }),
    );
  });

  it("model-checks stale snapshots around unacknowledged rename and archive facts", () => {
    const maxEventDepth = 3;

    for (const sequence of eventSequences(renameOrderingEvents(), maxEventDepth)) {
      const { catalog } = catalogFixture();
      receiveActive(catalog, [thread("target"), thread("other")]);
      receiveArchived(catalog, []);
      catalog.apply({ type: "thread-renamed", threadId: "target", name: "Renamed" });

      let renameAcknowledged = false;
      for (const event of sequence) {
        event.apply(catalog);
        renameAcknowledged = renameAcknowledged || event.acknowledgesRename;
      }

      if (!renameAcknowledged) {
        expectTargetName(catalog.activeSnapshot(), "Renamed", sequenceDescription(sequence));
        expectTargetName(catalog.archivedSnapshot(), "Renamed", sequenceDescription(sequence));
      }
    }

    for (const sequence of eventSequences(archiveOrderingEvents(), maxEventDepth)) {
      const { catalog } = catalogFixture();
      receiveActive(catalog, [thread("target"), thread("other")]);
      receiveArchived(catalog, [thread("archived", true)]);
      catalog.apply({ type: "thread-archived", threadId: "target" });

      let activeRemovalAcknowledged = false;
      let archivedUpsertAcknowledged = false;
      for (const event of sequence) {
        event.apply(catalog);
        activeRemovalAcknowledged = activeRemovalAcknowledged || event.acknowledgesActiveRemoval;
        archivedUpsertAcknowledged = archivedUpsertAcknowledged || event.acknowledgesArchivedUpsert;
      }

      const sequenceName = sequenceDescription(sequence);
      if (!activeRemovalAcknowledged) expectNoTarget(catalog.activeSnapshot(), sequenceName);
      if (!archivedUpsertAcknowledged) expectHasArchivedTarget(catalog.archivedSnapshot(), sequenceName);
    }
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
    receiveActive(catalog, [thread("active")]);
    receiveArchived(catalog, [thread("known", true)]);

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

interface ModeledCatalogEvent {
  readonly name: string;
  readonly acknowledgesRename: boolean;
  readonly acknowledgesActiveRemoval: boolean;
  readonly acknowledgesArchivedUpsert: boolean;
  apply(catalog: ThreadCatalog): void;
}

function renameOrderingEvents(): readonly ModeledCatalogEvent[] {
  return [
    modeledCatalogEvent("stale active snapshot", (catalog) => {
      receiveActive(catalog, [thread("target"), thread("other")]);
    }),
    modeledCatalogEvent(
      "rename-ack active snapshot",
      (catalog) => {
        receiveActive(catalog, [{ ...thread("target"), name: "Renamed" }, thread("other")]);
      },
      { acknowledgesRename: true },
    ),
    modeledCatalogEvent("empty archived snapshot", (catalog) => {
      receiveArchived(catalog, []);
    }),
  ];
}

function archiveOrderingEvents(): readonly ModeledCatalogEvent[] {
  return [
    modeledCatalogEvent("stale active snapshot", (catalog) => {
      receiveActive(catalog, [thread("target"), thread("other")]);
    }),
    modeledCatalogEvent(
      "archive-ack active snapshot",
      (catalog) => {
        receiveActive(catalog, [thread("other")]);
      },
      { acknowledgesActiveRemoval: true },
    ),
    modeledCatalogEvent("stale archived snapshot", (catalog) => {
      receiveArchived(catalog, [thread("archived", true)]);
    }),
    modeledCatalogEvent(
      "archive-ack archived snapshot",
      (catalog) => {
        receiveArchived(catalog, [thread("target", true), thread("archived", true)]);
      },
      { acknowledgesArchivedUpsert: true },
    ),
  ];
}

function modeledCatalogEvent(
  name: string,
  apply: (catalog: ThreadCatalog) => void,
  acknowledgements: Partial<
    Pick<ModeledCatalogEvent, "acknowledgesRename" | "acknowledgesActiveRemoval" | "acknowledgesArchivedUpsert">
  > = {},
): ModeledCatalogEvent {
  return {
    name,
    apply,
    acknowledgesRename: acknowledgements.acknowledgesRename ?? false,
    acknowledgesActiveRemoval: acknowledgements.acknowledgesActiveRemoval ?? false,
    acknowledgesArchivedUpsert: acknowledgements.acknowledgesArchivedUpsert ?? false,
  };
}

function eventSequences<T>(events: readonly T[], maxDepth: number): T[][] {
  const sequences: T[][] = [[]];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    for (const prefix of sequences.filter((sequence) => sequence.length === depth - 1)) {
      for (const event of events) {
        sequences.push([...prefix, event]);
      }
    }
  }
  return sequences;
}

function expectTargetName(threads: readonly Thread[] | null, expectedName: string, sequence: string): void {
  const target = threads?.find((item) => item.id === "target") ?? null;
  if (!target) return;
  expect(target.name, sequence).toBe(expectedName);
}

function expectNoTarget(threads: readonly Thread[] | null, sequence: string): void {
  expect(threads?.some((item) => item.id === "target") ?? false, sequence).toBe(false);
}

function expectHasArchivedTarget(threads: readonly Thread[] | null, sequence: string): void {
  expect(threads?.some((item) => item.id === "target" && item.archived) ?? false, sequence).toBe(true);
}

function sequenceDescription(sequence: readonly ModeledCatalogEvent[]): string {
  return sequence.length === 0 ? "no additional snapshots" : sequence.map((event) => event.name).join(" -> ");
}

const catalogStores = new WeakMap<ThreadCatalog, TestThreadCatalogStore>();

function receiveActive(catalog: ThreadCatalog, threads: readonly Thread[]): void {
  catalogStores.get(catalog)?.receiveActive(threads);
}

function receiveArchived(catalog: ThreadCatalog, threads: readonly Thread[]): void {
  catalogStores.get(catalog)?.receiveArchived(threads);
}

function catalogFixture(
  options: {
    fetchThreads?: (context: { codexPath: string; vaultPath: string }, archived: boolean) => Promise<readonly Thread[]>;
    context?: () => { codexPath: string; vaultPath: string };
    onEventApplied?: ThreadCatalogEventObserver;
  } = {},
) {
  const cache = cacheWithThreads(options.fetchThreads ?? (() => Promise.resolve([])));
  const context = options.context ?? (() => ({ codexPath: "codex", vaultPath: "/vault" }));
  const queries = new AppServerSharedQueries({
    cache,
    context,
  });
  const store = new TestThreadCatalogStore(cache, queries, context);
  const catalog = createThreadCatalog(
    options.onEventApplied
      ? {
          store,
          onEventApplied: options.onEventApplied,
        }
      : { store },
  );
  catalogStores.set(catalog, store);
  catalog.observeActive(() => undefined);
  catalog.observeArchived(() => undefined);
  return { cache, catalog };
}

class TestThreadCatalogStore {
  private readonly activeSnapshots = new Map<string, readonly Thread[]>();
  private readonly archivedSnapshots = new Map<string, readonly Thread[]>();
  private readonly activeObservers = new Set<ObservedResultListener<readonly Thread[]>>();
  private readonly archivedObservers = new Set<ObservedResultListener<readonly Thread[]>>();

  constructor(
    private readonly cache: AppServerQueryCache,
    private readonly queries: AppServerSharedQueries,
    private readonly currentContext: () => AppServerQueryContext,
  ) {}

  contextKey(): string {
    return appServerQueryContextKey(this.currentContext());
  }

  contextKeyFor(context: AppServerQueryContext): string {
    return appServerQueryContextKey(context);
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.activeSnapshots.get(this.contextKey()) ?? this.queries.activeThreadsSnapshot();
  }

  activeThreadsSnapshotFor(context: AppServerQueryContext): readonly Thread[] | null {
    return this.activeSnapshots.get(this.contextKeyFor(context)) ?? this.cache.activeThreadsSnapshot(context);
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.archivedSnapshots.get(this.contextKey()) ?? this.queries.archivedThreadsSnapshot();
  }

  archivedThreadsSnapshotFor(context: AppServerQueryContext): readonly Thread[] | null {
    return this.archivedSnapshots.get(this.contextKeyFor(context)) ?? this.cache.archivedThreadsSnapshot(context);
  }

  async fetchAllActiveThreads(): Promise<readonly Thread[]> {
    return this.receiveLoadedActive(await this.queries.fetchAllActiveThreads());
  }

  hasMoreActiveThreads(): boolean {
    return this.queries.hasMoreActiveThreads();
  }

  async loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.receiveLoadedActive(await this.queries.loadMoreActiveThreads());
  }

  async refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.receiveLoadedActive(await this.queries.refreshActiveThreads());
  }

  async refreshActiveThreadsFor(context: AppServerQueryContext): Promise<readonly Thread[]> {
    const threads = await this.cache.refreshActiveThreads(context);
    this.activeSnapshots.delete(this.contextKeyFor(context));
    return threads;
  }

  async refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.receiveLoadedArchived(await this.queries.refreshArchivedThreads());
  }

  async refreshArchivedThreadsFor(context: AppServerQueryContext): Promise<readonly Thread[]> {
    const threads = await this.cache.refreshArchivedThreads(context);
    this.archivedSnapshots.delete(this.contextKeyFor(context));
    return threads;
  }

  observeActiveThreadsResult(observer: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    this.activeObservers.add(observer);
    const unsubscribe = this.queries.observeActiveThreadsResult((result) => {
      if (result.value && !result.isFetching) this.activeSnapshots.delete(this.contextKey());
      observer(result);
    }, options);
    return () => {
      this.activeObservers.delete(observer);
      unsubscribe();
    };
  }

  observeArchivedThreadsResult(observer: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    this.archivedObservers.add(observer);
    const unsubscribe = this.queries.observeArchivedThreadsResult((result) => {
      if (result.value && !result.isFetching) this.archivedSnapshots.delete(this.contextKey());
      observer(result);
    }, options);
    return () => {
      this.archivedObservers.delete(observer);
      unsubscribe();
    };
  }

  receiveActive(threads: readonly Thread[]): void {
    this.activeSnapshots.set(this.contextKey(), threads);
    const result = observedSnapshot(threads);
    for (const observer of this.activeObservers) observer(result);
  }

  receiveArchived(threads: readonly Thread[]): void {
    this.archivedSnapshots.set(this.contextKey(), threads);
    const result = observedSnapshot(threads);
    for (const observer of this.archivedObservers) observer(result);
  }

  private receiveLoadedActive(threads: readonly Thread[]): readonly Thread[] {
    this.activeSnapshots.delete(this.contextKey());
    return threads;
  }

  private receiveLoadedArchived(threads: readonly Thread[]): readonly Thread[] {
    this.archivedSnapshots.delete(this.contextKey());
    return threads;
  }
}

function observedSnapshot(threads: readonly Thread[]): ObservedResult<readonly Thread[]> {
  return { value: threads, error: null, isFetching: false };
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
    provenance: { kind: "interactive" },
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
