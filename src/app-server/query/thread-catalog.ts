import type { Thread } from "../../domain/threads/model";
import type { ObservedResultListener } from "../../shared/query/observed-result";

type ThreadListObserver = ObservedResultListener<readonly Thread[]>;

interface ThreadCatalogStore {
  contextKey(): string;
  activeThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
  fetchActiveThreads(): Promise<readonly Thread[]>;
  fetchArchivedThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<readonly Thread[]>;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  observeActiveThreadsResult(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  observeArchivedThreadsResult(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  setActiveThreads(threads: readonly Thread[]): void;
  setArchivedThreads(threads: readonly Thread[]): void;
  updateActiveThreads(updater: (threads: readonly Thread[] | null) => readonly Thread[] | null): readonly Thread[] | null;
  updateArchivedThreads(updater: (threads: readonly Thread[] | null) => readonly Thread[] | null): readonly Thread[] | null;
}

interface PendingThreadUpsert {
  readonly thread: Thread;
  readonly acknowledgedBy: (thread: Thread) => boolean;
}

type PendingThreadUpserts = Map<string, PendingThreadUpsert>;
type PendingThreadRemovals = Set<string>;

interface PendingThreadListFacts {
  readonly upserts: PendingThreadUpserts;
  readonly removals: PendingThreadRemovals;
}

interface ThreadCatalogFacts {
  readonly active: PendingThreadListFacts;
  readonly archived: PendingThreadListFacts;
}

export type ThreadCatalogEventObserver = (event: ThreadCatalogEvent) => void;

export interface ThreadCatalogOptions {
  store: ThreadCatalogStore;
  onEventApplied?: ThreadCatalogEventObserver;
}

export type ThreadCatalogEvent =
  | { type: "active-list-snapshot-received"; threads: readonly Thread[] }
  | { type: "archived-list-snapshot-received"; threads: readonly Thread[] }
  | { type: "thread-started"; thread: Thread }
  | { type: "thread-forked"; thread: Thread }
  | { type: "thread-touched"; threadId: string; recencyAt?: number | null }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-archived"; threadId: string; options?: { closeOpenPanels?: boolean } }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-restored"; thread: Thread }
  | { type: "thread-unarchived"; threadId: string };

export interface ThreadCatalogActiveReader {
  activeSnapshot(): readonly Thread[] | null;
  loadActive(): Promise<readonly Thread[]>;
  refreshActive(): Promise<readonly Thread[]>;
  observeActive(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ThreadCatalogArchivedReader {
  archivedSnapshot(): readonly Thread[] | null;
  loadArchived(): Promise<readonly Thread[]>;
  refreshArchived(): Promise<readonly Thread[]>;
  observeArchived(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ThreadCatalogEventSink {
  apply(event: ThreadCatalogEvent): void;
}

export interface ThreadCatalog extends ThreadCatalogActiveReader, ThreadCatalogArchivedReader, ThreadCatalogEventSink {}

export function createThreadCatalog(options: ThreadCatalogOptions): ThreadCatalog {
  const factsByContext = new Map<string, ThreadCatalogFacts>();
  const { store } = options;
  const currentFacts = (): ThreadCatalogFacts => threadCatalogFactsForContext(factsByContext, store.contextKey());
  const apply = (event: ThreadCatalogEvent): void => {
    const facts = currentFacts();
    applyThreadCatalogEvent(store, facts.active, facts.archived, event);
    options.onEventApplied?.(event);
  };

  return {
    apply,
    activeSnapshot: () => threadListProjection(store.activeThreadsSnapshot(), currentFacts().active),
    loadActive: () => loadThreadList(store.fetchActiveThreads(), currentFacts().active),
    refreshActive: () => loadThreadList(store.refreshActiveThreads(), currentFacts().active),
    observeActive: (observer, observeOptions) =>
      store.observeActiveThreadsResult((result) => {
        observer({
          ...result,
          value: threadListProjection(result.value, currentFacts().active),
        });
      }, observeOptions),
    archivedSnapshot: () => threadListProjection(store.archivedThreadsSnapshot(), currentFacts().archived),
    loadArchived: () => loadThreadList(store.fetchArchivedThreads(), currentFacts().archived),
    refreshArchived: () => loadThreadList(store.refreshArchivedThreads(), currentFacts().archived),
    observeArchived: (observer, observeOptions) =>
      store.observeArchivedThreadsResult((result) => {
        observer({
          ...result,
          value: threadListProjection(result.value, currentFacts().archived),
        });
      }, observeOptions),
  };
}

function threadCatalogFactsForContext(factsByContext: Map<string, ThreadCatalogFacts>, contextKey: string): ThreadCatalogFacts {
  const existing = factsByContext.get(contextKey);
  if (existing) return existing;
  const facts = {
    active: pendingThreadListFacts(),
    archived: pendingThreadListFacts(),
  };
  factsByContext.set(contextKey, facts);
  return facts;
}

function applyThreadCatalogEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  event: ThreadCatalogEvent,
): void {
  switch (event.type) {
    case "active-list-snapshot-received":
      acknowledgeThreadListSnapshot(activeFacts, event.threads);
      store.setActiveThreads(event.threads);
      return;
    case "archived-list-snapshot-received":
      acknowledgeThreadListSnapshot(archivedFacts, event.threads);
      store.setArchivedThreads(event.threads);
      return;
    case "thread-started":
      upsertActiveThread(store, activeFacts, event.thread, acknowledgeByThreadId);
      return;
    case "thread-forked":
      upsertActiveThread(store, activeFacts, event.thread, acknowledgedByThreadVersion(event.thread));
      return;
    case "thread-touched":
      applyThreadTouchedEvent(store, activeFacts, event.threadId, event.recencyAt);
      return;
    case "thread-renamed":
      applyThreadRenamedEvent(store, activeFacts, archivedFacts, event.threadId, event.name);
      return;
    case "thread-archived":
      applyThreadArchivedEvent(store, activeFacts, archivedFacts, event.threadId);
      return;
    case "thread-deleted":
      applyThreadDeletedEvent(store, activeFacts, archivedFacts, event.threadId);
      return;
    case "thread-restored":
      applyThreadRestoredEvent(store, activeFacts, archivedFacts, event.thread);
      return;
    case "thread-unarchived":
      applyThreadUnarchivedEvent(store, activeFacts, archivedFacts, event.threadId);
      return;
  }
}

async function loadThreadList(threadsPromise: Promise<readonly Thread[]>, facts: PendingThreadListFacts): Promise<readonly Thread[]> {
  const threads = await threadsPromise;
  acknowledgeThreadListSnapshot(facts, threads);
  return threadListProjection(threads, facts) ?? [];
}

function upsertActiveThread(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  thread: Thread,
  acknowledgedBy: (thread: Thread) => boolean,
): void {
  rememberPendingThreadUpsert(activeFacts, thread, acknowledgedBy);
  store.updateActiveThreads((current) => promoteThreadInList(current ?? [], thread));
}

function applyThreadTouchedEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  threadId: string,
  recencyAt: number | null | undefined,
): void {
  const existingFact = activeFacts.upserts.get(threadId)?.thread ?? null;
  let touchedThread = existingFact ? touchedActiveThread(existingFact, recencyAt) : null;
  const nextThreads = store.updateActiveThreads((current) => {
    const currentThread = threadListProjection(current, activeFacts)?.find((thread) => thread.id === threadId) ?? touchedThread;
    if (!currentThread) return current;
    touchedThread = touchedActiveThread(currentThread, recencyAt);
    return promoteThreadInList(current ?? [], touchedThread);
  });
  if (!touchedThread) return;
  const promotedThread = touchedThread;
  rememberPendingThreadUpsert(
    activeFacts,
    promotedThread,
    recencyAt === undefined ? acknowledgeByThreadId : acknowledgedByRecency(recencyAt),
  );
  if (!nextThreads) {
    store.updateActiveThreads(() => [promotedThread]);
  }
}

function applyThreadRenamedEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  threadId: string,
  name: string | null,
): void {
  const activeThread = threadListProjection(store.activeThreadsSnapshot(), activeFacts)?.find((thread) => thread.id === threadId) ?? null;
  if (activeThread) rememberPendingThreadUpsert(activeFacts, { ...activeThread, name }, acknowledgedByName(name));
  store.updateActiveThreads((current) =>
    current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null,
  );
  const archivedThread =
    threadListProjection(store.archivedThreadsSnapshot(), archivedFacts)?.find((thread) => thread.id === threadId) ?? null;
  if (archivedThread) rememberPendingThreadUpsert(archivedFacts, { ...archivedThread, name }, acknowledgedByName(name));
  store.updateArchivedThreads((current) =>
    current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null,
  );
}

function applyThreadArchivedEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  threadId: string,
): void {
  const archivedThread = threadListProjection(store.activeThreadsSnapshot(), activeFacts)?.find((thread) => thread.id === threadId);
  rememberPendingThreadRemoval(activeFacts, threadId);
  store.updateActiveThreads((current) => {
    return current ? current.filter((thread) => thread.id !== threadId) : null;
  });
  if (archivedThread) {
    const pendingArchivedThread = { ...archivedThread, archived: true };
    rememberPendingThreadUpsert(archivedFacts, pendingArchivedThread, acknowledgeByThreadId);
    store.updateArchivedThreads((current) => promoteThreadInList(current ?? [], pendingArchivedThread));
  } else {
    refreshArchivedThreadsAfterUnknownArchive(store, archivedFacts);
  }
}

function applyThreadDeletedEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  threadId: string,
): void {
  rememberPendingThreadRemoval(activeFacts, threadId);
  rememberPendingThreadRemoval(archivedFacts, threadId);
  store.updateActiveThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
  store.updateArchivedThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
}

function applyThreadRestoredEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  thread: Thread,
): void {
  upsertActiveThread(store, activeFacts, { ...thread, archived: false }, acknowledgeByThreadId);
  rememberPendingThreadRemoval(archivedFacts, thread.id);
  store.updateArchivedThreads((current) => (current ? current.filter((item) => item.id !== thread.id) : null));
}

function applyThreadUnarchivedEvent(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
  threadId: string,
): void {
  const restoredThread =
    threadListProjection(store.archivedThreadsSnapshot(), archivedFacts)?.find((thread) => thread.id === threadId) ?? null;
  rememberPendingThreadRemoval(archivedFacts, threadId);
  store.updateArchivedThreads((current) => {
    return current ? current.filter((thread) => thread.id !== threadId) : null;
  });
  if (restoredThread) {
    upsertActiveThread(store, activeFacts, { ...restoredThread, archived: false }, acknowledgeByThreadId);
    return;
  }
  refreshThreadListsAfterUnknownUnarchive(store, activeFacts, archivedFacts);
}

function threadListProjection(snapshot: readonly Thread[] | null, facts: PendingThreadListFacts): readonly Thread[] | null {
  if (!snapshot && facts.upserts.size === 0 && facts.removals.size === 0) return null;
  const threads = (snapshot ?? [])
    .filter((thread) => !facts.removals.has(thread.id))
    .map((thread) => facts.upserts.get(thread.id)?.thread ?? thread);
  const snapshotThreadIds = new Set(threads.map((thread) => thread.id));
  const pendingThreads = Array.from(facts.upserts.values())
    .map((entry) => entry.thread)
    .filter((thread) => !facts.removals.has(thread.id) && !snapshotThreadIds.has(thread.id));
  return pendingThreads.length === 0 ? threads : [...pendingThreads.reverse(), ...threads];
}

function pendingThreadListFacts(): PendingThreadListFacts {
  return {
    upserts: new Map(),
    removals: new Set(),
  };
}

function acknowledgeThreadListSnapshot(facts: PendingThreadListFacts, threads: readonly Thread[]): void {
  const threadIds = new Set(threads.map((thread) => thread.id));
  for (const thread of threads) {
    const upsert = facts.upserts.get(thread.id);
    if (upsert?.acknowledgedBy(thread)) facts.upserts.delete(thread.id);
  }
  for (const threadId of [...facts.removals]) {
    if (!threadIds.has(threadId)) facts.removals.delete(threadId);
  }
}

function rememberPendingThreadUpsert(facts: PendingThreadListFacts, thread: Thread, acknowledgedBy: (thread: Thread) => boolean): void {
  facts.removals.delete(thread.id);
  facts.upserts.delete(thread.id);
  facts.upserts.set(thread.id, { thread, acknowledgedBy });
}

function rememberPendingThreadRemoval(facts: PendingThreadListFacts, threadId: string): void {
  facts.upserts.delete(threadId);
  facts.removals.add(threadId);
}

function touchedActiveThread(thread: Thread, recencyAt: number | null | undefined): Thread {
  return recencyAt === undefined ? thread : { ...thread, recencyAt };
}

function acknowledgeByThreadId(): boolean {
  return true;
}

function acknowledgedByName(name: string | null): (thread: Thread) => boolean {
  return (thread) => thread.name === name;
}

function acknowledgedByThreadVersion(reference: Thread): (thread: Thread) => boolean {
  return (thread) =>
    thread.updatedAt > reference.updatedAt ||
    (thread.updatedAt === reference.updatedAt &&
      thread.preview === reference.preview &&
      thread.name === reference.name &&
      thread.recencyAt === reference.recencyAt);
}

function acknowledgedByRecency(recencyAt: number | null): (thread: Thread) => boolean {
  return (thread) => thread.recencyAt === recencyAt;
}

function promoteThreadInList(threads: readonly Thread[], thread: Thread): readonly Thread[] {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return [thread, ...withoutThread];
}

function refreshArchivedThreadsAfterUnknownArchive(store: ThreadCatalogStore, archivedFacts: PendingThreadListFacts): void {
  // A force refresh can join an older in-flight archived request. Run one more
  // refresh afterward so an archive recorded during that request is not lost.
  void store
    .refreshArchivedThreads()
    .then((threads) => {
      acknowledgeThreadListSnapshot(archivedFacts, threads);
      return store.refreshArchivedThreads();
    })
    .then((threads) => {
      acknowledgeThreadListSnapshot(archivedFacts, threads);
    })
    .catch(() => undefined);
}

function refreshThreadListsAfterUnknownUnarchive(
  store: ThreadCatalogStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
): void {
  // Unknown unarchives need both lists: active gains the thread, archived loses it.
  void Promise.all([store.refreshActiveThreads(), store.refreshArchivedThreads()])
    .then(([activeThreads, archivedThreads]) => {
      acknowledgeThreadListSnapshot(activeFacts, activeThreads);
      acknowledgeThreadListSnapshot(archivedFacts, archivedThreads);
    })
    .catch(() => undefined);
}
