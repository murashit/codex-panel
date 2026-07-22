import { describe, expect, it, vi } from "vitest";

import { applyThreadListMutation, type ThreadListMutation } from "../../../../src/app-server/query/thread-list-mutation";
import type { Thread } from "../../../../src/domain/threads/model";
import { createThreadOperationCoordinator } from "../../../../src/features/threads/workflows/thread-operation-coordinator";
import type { ThreadLifecycleEvent } from "../../../../src/features/threads/workflows/thread-operation-event";
import { projectThreadListChanges } from "../../../../src/features/threads/workflows/thread-read-model-projection";

describe("ThreadOperationCoordinator", () => {
  it("commits ordinary facts directly and a completed fork as one ordered fact batch", () => {
    const commit = vi.fn();
    const coordinator = createThreadOperationCoordinator(commit);

    coordinator.apply({ type: "thread-renamed", threadId: "other", name: "Other" });
    const publication = coordinator.beginForkPublication("source");
    publication.record(thread("child"));
    coordinator.apply({ type: "thread-archived", threadId: "child" });
    coordinator.apply({ type: "thread-archived", threadId: "source" });
    publication.finish({ sourceArchived: true });

    expect(commit).toHaveBeenNthCalledWith(1, [{ type: "thread-renamed", threadId: "other", name: "Other" }]);
    expect(commit).toHaveBeenNthCalledWith(2, [
      { type: "thread-upserted", thread: thread("child") },
      { type: "thread-archived", threadId: "child" },
      { type: "thread-archived", threadId: "source" },
    ]);
  });

  it("holds unclaimed fork notifications until every publication for the source finishes", () => {
    const commit = vi.fn();
    const coordinator = createThreadOperationCoordinator(commit);
    const first = coordinator.beginForkPublication("source");
    const second = coordinator.beginForkPublication("source");
    first.record(thread("first"));
    second.record(thread("second"));
    coordinator.apply({ type: "thread-upserted", thread: thread("unclaimed"), forkedFromThreadId: "source" });

    first.finish();

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenLastCalledWith([{ type: "thread-upserted", thread: thread("first") }]);

    second.finish();

    expect(commit).toHaveBeenNthCalledWith(2, [{ type: "thread-upserted", thread: thread("second") }]);
    expect(commit).toHaveBeenNthCalledWith(3, [{ type: "thread-upserted", thread: thread("unclaimed") }]);
  });

  it("carries lifecycle observed before the fork response into the claimed child", () => {
    const commit = vi.fn();
    const coordinator = createThreadOperationCoordinator(commit);
    const publication = coordinator.beginForkPublication("source");
    coordinator.apply({
      type: "thread-upserted",
      thread: thread("child", false, { preview: "notification" }),
      forkedFromThreadId: "source",
    });
    coordinator.apply({ type: "thread-renamed", threadId: "child", name: "External" });
    coordinator.apply({ type: "thread-archived", threadId: "child" });

    publication.record(thread("child", false, { preview: "response" }));
    publication.finish();

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith([
      { type: "thread-upserted", thread: thread("child", false, { preview: "response", name: "External" }) },
      { type: "thread-archived", threadId: "child" },
    ]);
  });

  it("settles source lifecycle only after every publication for the source finishes", () => {
    const commit = vi.fn();
    const coordinator = createThreadOperationCoordinator(commit);
    const first = coordinator.beginForkPublication("source");
    const second = coordinator.beginForkPublication("source");
    first.record(thread("first"));
    second.record(thread("second"));
    coordinator.apply({ type: "thread-archived", threadId: "source" });

    first.finish({ sourceArchived: true });
    coordinator.apply({ type: "thread-unarchived", threadId: "source" });
    second.finish();

    expect(commit).toHaveBeenNthCalledWith(1, [{ type: "thread-upserted", thread: thread("first") }]);
    expect(commit).toHaveBeenNthCalledWith(2, [{ type: "thread-upserted", thread: thread("second") }]);
  });

  it("commits a restored source even when a failed fork produced no child", () => {
    const commit = vi.fn();
    const coordinator = createThreadOperationCoordinator(commit);
    const publication = coordinator.beginForkPublication("source");
    const restored = thread("source", true, { preview: "restored" });
    coordinator.apply({ type: "thread-archived", threadId: "source" });
    coordinator.apply({ type: "thread-restored", thread: restored });

    publication.finish({ sourceArchived: true });

    expect(commit).toHaveBeenCalledWith([{ type: "thread-restored", thread: restored }]);
  });

  it("projects rename and archive events through the shared query owner", () => {
    const store = catalogStore({
      active: [thread("active"), thread("other")],
      archived: [thread("archived", true)],
    });
    const onEventApplied = vi.fn();
    const coordinator = operationCoordinatorForStore(store, onEventApplied);

    coordinator.apply({ type: "thread-renamed", threadId: "active", name: "Renamed" });
    coordinator.apply({ type: "thread-archived", threadId: "active" });

    expect(store.activeThreadsSnapshot()).toEqual([thread("other")]);
    expect(store.archivedThreadsSnapshot()).toEqual([{ ...thread("active"), name: "Renamed", archived: true }, thread("archived", true)]);
    expect(onEventApplied).toHaveBeenCalledTimes(2);
  });

  it("publishes a fork replacement to active observers as one mutation batch", () => {
    const store = catalogStore({ active: [thread("source"), thread("other")], archived: [] });
    const onEventApplied = vi.fn();
    const coordinator = operationCoordinatorForStore(store, onEventApplied);
    const publication = coordinator.beginForkPublication("source");

    coordinator.apply({
      type: "thread-upserted",
      thread: thread("forked"),
      forkedFromThreadId: "source",
    });
    publication.record(thread("forked"));
    coordinator.apply({ type: "thread-upserted", thread: thread("forked", false, { preview: "resumed" }) });
    coordinator.apply({ type: "thread-renamed", threadId: "forked", name: "Forked title" });
    coordinator.apply({ type: "thread-archived", threadId: "source" });

    expect(store.appliedMutationBatches).toEqual([]);

    publication.finish({ sourceArchived: true });

    expect(store.appliedMutationBatches).toHaveLength(1);
    expect(store.activeThreadsSnapshot()).toEqual([{ ...thread("forked"), preview: "resumed", name: "Forked title" }, thread("other")]);
    expect(store.archivedThreadsSnapshot()).toEqual([thread("source", true)]);
    expect(onEventApplied).toHaveBeenCalledOnce();
    expect(onEventApplied).toHaveBeenCalledWith([
      {
        type: "thread-upserted",
        thread: { ...thread("forked"), preview: "resumed", name: "Forked title" },
      },
      { type: "thread-archived", threadId: "source" },
    ]);
  });

  it("publishes a normal fork once without removing its source", () => {
    const store = catalogStore({ active: [thread("source")] });
    const publication = operationCoordinatorForStore(store).beginForkPublication("source");

    publication.record(thread("forked"));
    publication.finish();

    expect(store.appliedMutationBatches).toHaveLength(1);
    expect(store.activeThreadsSnapshot()).toEqual([thread("forked"), thread("source")]);
  });

  it("keeps the source active when an unarchive supersedes a deferred archive", () => {
    const store = catalogStore({ active: [thread("source")], archived: [] });
    const coordinator = operationCoordinatorForStore(store);
    const publication = coordinator.beginForkPublication("source");
    publication.record(thread("forked"));

    coordinator.apply({ type: "thread-archived", threadId: "source" });
    coordinator.apply({ type: "thread-unarchived", threadId: "source" });
    publication.finish({ sourceArchived: true });

    expect(store.appliedMutationBatches).toHaveLength(1);
    expect(store.activeThreadsSnapshot()).toEqual([thread("forked"), thread("source")]);
    expect(store.archivedThreadsSnapshot()).toEqual([]);
  });

  it("publishes the restored source record that supersedes a deferred archive", () => {
    const store = catalogStore({ active: [thread("source")], archived: [] });
    const coordinator = operationCoordinatorForStore(store);
    const publication = coordinator.beginForkPublication("source");
    publication.record(thread("forked"));
    const restoredSource = thread("source", true, { preview: "restored preview", updatedAt: 4 });

    coordinator.apply({ type: "thread-archived", threadId: "source" });
    coordinator.apply({ type: "thread-restored", thread: restoredSource });
    publication.finish({ sourceArchived: true });

    expect(store.appliedMutationBatches).toHaveLength(1);
    expect(store.activeThreadsSnapshot()).toEqual([thread("forked"), { ...restoredSource, archived: false }]);
    expect(store.archivedThreadsSnapshot()).toEqual([]);
  });

  it("does not resurrect a fork child archived before publication finishes", () => {
    const store = catalogStore({ active: [thread("source")], archived: [] });
    const coordinator = operationCoordinatorForStore(store);
    const publication = coordinator.beginForkPublication("source");
    publication.record(thread("forked"));

    coordinator.apply({ type: "thread-archived", threadId: "forked" });
    coordinator.apply({ type: "thread-archived", threadId: "source" });
    publication.finish({ sourceArchived: true });

    expect(store.appliedMutationBatches).toHaveLength(1);
    expect(store.activeThreadsSnapshot()).toEqual([]);
    expect(store.archivedThreadsSnapshot()).toEqual([thread("source", true), thread("forked", true)]);
  });

  it("does not delay unrelated catalog events during a fork publication", () => {
    const store = catalogStore({ active: [thread("source")] });
    const coordinator = operationCoordinatorForStore(store);
    const publication = coordinator.beginForkPublication("source");

    coordinator.apply({ type: "thread-upserted", thread: thread("unrelated") });

    expect(store.activeThreadsSnapshot()).toEqual([thread("unrelated"), thread("source")]);
    publication.finish();
  });

  it("does not invent an archived record when an archive event lacks a source snapshot", () => {
    const store = catalogStore();
    const coordinator = operationCoordinatorForStore(store);

    coordinator.apply({ type: "thread-archived", threadId: "unknown" });

    expect(store.appliedMutations).toEqual([
      { kind: "remove", list: "active", threadId: "unknown" },
      { kind: "refresh", list: "archived" },
    ]);
  });

  it("moves known restored and unarchived threads between lists", () => {
    const store = catalogStore({
      active: [thread("active")],
      archived: [thread("restored", true), thread("unarchived", true)],
    });
    const coordinator = operationCoordinatorForStore(store);

    coordinator.apply({ type: "thread-restored", thread: thread("restored", true) });
    coordinator.apply({ type: "thread-unarchived", threadId: "unarchived" });

    expect(store.activeThreadsSnapshot()).toEqual([thread("unarchived"), thread("restored"), thread("active")]);
    expect(store.archivedThreadsSnapshot()).toEqual([]);
  });

  it("patches exact rename and delete facts without inventing unknown thread records", () => {
    const store = catalogStore({
      active: [thread("active"), thread("kept")],
      archived: [thread("deleted", true)],
    });
    const coordinator = operationCoordinatorForStore(store);

    coordinator.apply({ type: "thread-renamed", threadId: "missing", name: "Not invented" });
    coordinator.apply({ type: "thread-deleted", threadId: "deleted" });

    expect(store.activeThreadsSnapshot()).toEqual([thread("active"), thread("kept")]);
    expect(store.archivedThreadsSnapshot()).toEqual([]);
  });
});

function operationCoordinatorForStore(
  store: ReturnType<typeof catalogStore>,
  onEventsApplied?: (events: readonly ThreadLifecycleEvent[]) => void,
) {
  return createThreadOperationCoordinator((events) => {
    store.applyThreadListMutations(projectThreadListChanges(store, events));
    onEventsApplied?.(events);
  });
}

interface CatalogStoreOptions {
  readonly active?: readonly Thread[] | null;
  readonly archived?: readonly Thread[] | null;
}

function catalogStore(options: CatalogStoreOptions = {}) {
  let active = options.active ?? null;
  let archived = options.archived ?? null;
  const appliedMutations: ThreadListMutation[] = [];
  const appliedMutationBatches: ThreadListMutation[][] = [];
  const applyMutations = (mutations: readonly ThreadListMutation[]): void => {
    appliedMutationBatches.push([...mutations]);
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
    appliedMutationBatches,
    activeThreadsSnapshot: () => active,
    archivedThreadsSnapshot: () => archived,
    applyThreadListMutations: applyMutations,
  };
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
