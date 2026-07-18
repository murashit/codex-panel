import { describe, expect, it, vi } from "vitest";

import type { AppServerQueryContextIdentity } from "../../../../src/app-server/query/keys";
import type { ObservedResultListener } from "../../../../src/app-server/query/observed-result";
import { applyThreadListMutation, type ThreadListMutation } from "../../../../src/app-server/query/thread-list-mutation";
import type { Thread } from "../../../../src/domain/threads/model";
import { createThreadCatalog } from "../../../../src/features/threads/catalog/thread-catalog";

describe("ThreadCatalog", () => {
  it("projects rename and archive events through the shared query owner", () => {
    const store = catalogStore({
      active: [thread("active"), thread("other")],
      archived: [thread("archived", true)],
    });
    const onEventApplied = vi.fn();
    const catalog = createThreadCatalog({ store, onEventApplied });

    catalog.apply({ type: "thread-renamed", threadId: "active", name: "Renamed" });
    catalog.apply({ type: "thread-archived", threadId: "active" });

    expect(catalog.activeSnapshot()).toEqual([thread("other")]);
    expect(catalog.archivedSnapshot()).toEqual([{ ...thread("active"), name: "Renamed", archived: true }, thread("archived", true)]);
    expect(onEventApplied).toHaveBeenCalledTimes(2);
  });

  it("does not invent an archived record when an archive event lacks a source snapshot", () => {
    const store = catalogStore();
    const catalog = createThreadCatalog({ store });

    catalog.apply({ type: "thread-archived", threadId: "unknown" });

    expect(store.appliedMutations).toEqual([{ kind: "remove", list: "active", threadId: "unknown" }]);
  });

  it("moves known restored and unarchived threads between lists", () => {
    const store = catalogStore({
      active: [thread("active")],
      archived: [thread("restored", true), thread("unarchived", true)],
    });
    const catalog = createThreadCatalog({ store });

    catalog.apply({ type: "thread-restored", thread: thread("restored", true) });
    catalog.apply({ type: "thread-unarchived", threadId: "unarchived" });

    expect(catalog.activeSnapshot()).toEqual([thread("unarchived"), thread("restored"), thread("active")]);
    expect(catalog.archivedSnapshot()).toEqual([]);
  });

  it("patches exact rename and delete facts without inventing unknown thread records", () => {
    const store = catalogStore({
      active: [thread("active"), thread("kept")],
      archived: [thread("deleted", true)],
    });
    const catalog = createThreadCatalog({ store });

    catalog.apply({ type: "thread-renamed", threadId: "missing", name: "Not invented" });
    catalog.apply({ type: "thread-deleted", threadId: "deleted" });

    expect(catalog.activeSnapshot()).toEqual([thread("active"), thread("kept")]);
    expect(catalog.archivedSnapshot()).toEqual([]);
  });

  it("ignores connection events from an earlier resource lease", () => {
    const store = catalogStore();
    const catalog = createThreadCatalog({ store });
    const staleContext = { codexPath: "codex", vaultPath: "/vault", generation: 0 };

    catalog.applyConnectionEvent(staleContext, { type: "thread-upserted", thread: thread("stale") });

    expect(store.appliedMutations).toEqual([]);
    expect(catalog.activeSnapshot()).toBeNull();
  });

  it("delegates reads, pagination, and observation without a second projection store", async () => {
    const store = catalogStore({ active: [thread("active")], archived: [thread("archived", true)] });
    const catalog = createThreadCatalog({ store });
    const activeObserver = vi.fn();
    const archivedObserver = vi.fn();

    expect(await catalog.loadActive()).toEqual([thread("active")]);
    expect(await catalog.refreshActive()).toEqual([thread("active")]);
    expect(catalog.hasMoreActive()).toBe(false);
    expect(await catalog.loadMoreActive()).toEqual([thread("active")]);
    expect(await catalog.refreshArchived()).toEqual([thread("archived", true)]);

    const unsubscribeActive = catalog.observeActive(activeObserver);
    const unsubscribeArchived = catalog.observeArchived(archivedObserver);
    expect(activeObserver).toHaveBeenCalledWith({ value: [thread("active")], error: null, isFetching: false });
    expect(archivedObserver).toHaveBeenCalledWith({ value: [thread("archived", true)], error: null, isFetching: false });
    unsubscribeActive();
    unsubscribeArchived();
  });
});

interface CatalogStoreOptions {
  readonly active?: readonly Thread[] | null;
  readonly archived?: readonly Thread[] | null;
}

function catalogStore(options: CatalogStoreOptions = {}) {
  let active = options.active ?? null;
  let archived = options.archived ?? null;
  const activeObservers = new Set<ObservedResultListener<readonly Thread[]>>();
  const archivedObservers = new Set<ObservedResultListener<readonly Thread[]>>();
  const appliedMutations: ThreadListMutation[] = [];
  const currentContext: AppServerQueryContextIdentity = {
    codexPath: "codex",
    vaultPath: "/vault",
    generation: 1,
  };
  const applyMutations = (mutations: readonly ThreadListMutation[]): void => {
    appliedMutations.push(...mutations);
    for (const mutation of mutations) {
      if (mutation.list === "active") {
        active = applyThreadListMutation(active, mutation);
      } else {
        archived = applyThreadListMutation(archived, mutation);
      }
    }
  };
  return {
    appliedMutations,
    contextKey: () => contextKey(currentContext),
    contextKeyFor: contextKey,
    activeThreadsSnapshot: () => active,
    archivedThreadsSnapshot: () => archived,
    fetchAllActiveThreads: async () => active ?? [],
    hasMoreActiveThreads: () => false,
    loadMoreActiveThreads: async () => active ?? [],
    refreshActiveThreads: async () => active ?? [],
    refreshArchivedThreads: async () => archived ?? [],
    applyThreadListMutations: applyMutations,
    observeActiveThreadsResult: (observer: ObservedResultListener<readonly Thread[]>, observeOptions: { emitCurrent?: boolean } = {}) => {
      activeObservers.add(observer);
      if (observeOptions.emitCurrent ?? true) observer({ value: active, error: null, isFetching: false });
      return () => activeObservers.delete(observer);
    },
    observeArchivedThreadsResult: (observer: ObservedResultListener<readonly Thread[]>, observeOptions: { emitCurrent?: boolean } = {}) => {
      archivedObservers.add(observer);
      if (observeOptions.emitCurrent ?? true) observer({ value: archived, error: null, isFetching: false });
      return () => archivedObservers.delete(observer);
    },
  };
}

function contextKey(context: AppServerQueryContextIdentity): string {
  return `${String(context.generation)}:${context.codexPath}:${context.vaultPath}`;
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
