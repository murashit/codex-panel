import type { AppServerQueryContextIdentity } from "../../../app-server/query/keys";
import type { ObservedResult, ObservedResultListener } from "../../../app-server/query/observed-result";
import type { Thread } from "../../../domain/threads/model";

type ThreadListObserver = ObservedResultListener<readonly Thread[]>;

interface ThreadCatalogStore {
  contextKey(): string;
  contextKeyFor(context: AppServerQueryContextIdentity): string;
  activeThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
  fetchAllActiveThreads(): Promise<readonly Thread[]>;
  hasMoreActiveThreads(): boolean;
  loadMoreActiveThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<readonly Thread[]>;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  observeActiveThreadsResult(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  observeArchivedThreadsResult(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

type ThreadCatalogEventStore = Pick<
  ThreadCatalogStore,
  "activeThreadsSnapshot" | "archivedThreadsSnapshot" | "refreshActiveThreads" | "refreshArchivedThreads"
>;

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
  activeObservedResult: ObservedResult<readonly Thread[]> | null;
  archivedObservedResult: ObservedResult<readonly Thread[]> | null;
}

type ThreadCatalogEventObserver = (event: ThreadCatalogEvent) => void;

export interface ThreadCatalogOptions {
  store: ThreadCatalogStore;
  onEventApplied?: ThreadCatalogEventObserver;
}

export type ThreadCatalogEvent =
  | { type: "thread-started"; thread: Thread }
  | { type: "thread-forked"; thread: Thread }
  | { type: "thread-touched"; threadId: string; recencyAt?: number | null }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-archived"; threadId: string }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-restored"; thread: Thread }
  | { type: "thread-unarchived"; threadId: string };

export interface ThreadCatalogActiveReader {
  activeSnapshot(): readonly Thread[] | null;
  loadActive(): Promise<readonly Thread[]>;
  refreshActive(): Promise<readonly Thread[]>;
  observeActive(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ThreadCatalogPaginatedActiveReader extends ThreadCatalogActiveReader {
  hasMoreActive(): boolean;
  loadMoreActive(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogArchivedReader {
  archivedSnapshot(): readonly Thread[] | null;
  refreshArchived(): Promise<readonly Thread[]>;
  observeArchived(observer: ThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ThreadCatalogEventSink {
  apply(event: ThreadCatalogEvent): void;
}

export interface ThreadCatalogConnectionEventSink {
  applyConnectionEvent(context: AppServerQueryContextIdentity, event: ThreadCatalogEvent): void;
}

export interface ThreadCatalog
  extends ThreadCatalogPaginatedActiveReader,
    ThreadCatalogArchivedReader,
    ThreadCatalogEventSink,
    ThreadCatalogConnectionEventSink {
  clear(): void;
}

export function createThreadCatalog(options: ThreadCatalogOptions): ThreadCatalog {
  let factsState: { contextKey: string; facts: ThreadCatalogFacts } | null = null;
  const activeObservers = new Set<ThreadListObserver>();
  const archivedObservers = new Set<ThreadListObserver>();
  const { store } = options;
  const currentFacts = (): ThreadCatalogFacts => {
    const contextKey = store.contextKey();
    if (factsState?.contextKey === contextKey) return factsState.facts;
    const facts = pendingThreadCatalogFacts();
    factsState = { contextKey, facts };
    return facts;
  };
  const activeRawSnapshot = (): readonly Thread[] | null => store.activeThreadsSnapshot();
  const archivedRawSnapshot = (): readonly Thread[] | null => store.archivedThreadsSnapshot();
  const publish = (kind: ThreadListKind): void => {
    const facts = currentFacts();
    const raw = kind === "active" ? activeRawSnapshot() : archivedRawSnapshot();
    const value = threadListProjection(raw, kind === "active" ? facts.active : facts.archived);
    const observedResult = kind === "active" ? facts.activeObservedResult : facts.archivedObservedResult;
    const result: ObservedResult<readonly Thread[]> = {
      ...(observedResult ?? { error: null, isFetching: false }),
      value,
    };
    for (const observer of kind === "active" ? activeObservers : archivedObservers) observer(result);
  };
  const applyToFacts = (
    eventStore: ThreadCatalogEventStore,
    facts: ThreadCatalogFacts,
    event: ThreadCatalogEvent,
    publishChanges: boolean,
  ): void => {
    const changed = applyThreadCatalogEvent(eventStore, facts, event);
    if (publishChanges) {
      if (changed.active) publish("active");
      if (changed.archived) publish("archived");
      options.onEventApplied?.(event);
    }
  };
  const apply = (event: ThreadCatalogEvent): void => {
    applyToFacts(store, currentFacts(), event, true);
  };

  return {
    apply,
    applyConnectionEvent: (context, event) => {
      const capturedContextKey = store.contextKeyFor(context);
      if (capturedContextKey !== store.contextKey()) return;
      applyToFacts(store, currentFacts(), event, true);
    },
    clear: () => {
      factsState = null;
    },
    activeSnapshot: () => threadListProjection(activeRawSnapshot(), currentFacts().active),
    loadActive: () => loadThreadList(store.fetchAllActiveThreads(), currentFacts().active),
    refreshActive: () => loadThreadList(store.refreshActiveThreads(), currentFacts().active),
    hasMoreActive: () => store.hasMoreActiveThreads(),
    loadMoreActive: () => loadThreadList(store.loadMoreActiveThreads(), currentFacts().active),
    observeActive: (observer, observeOptions) => {
      activeObservers.add(observer);
      const unsubscribe = store.observeActiveThreadsResult((result) => {
        const facts = currentFacts();
        facts.activeObservedResult = result;
        if (result.value) acknowledgeThreadListSnapshot(facts.active, result.value);
        observer({
          ...result,
          value: threadListProjection(result.value, facts.active),
        });
      }, observeOptions);
      return () => {
        activeObservers.delete(observer);
        unsubscribe();
      };
    },
    archivedSnapshot: () => threadListProjection(archivedRawSnapshot(), currentFacts().archived),
    refreshArchived: () => loadThreadList(store.refreshArchivedThreads(), currentFacts().archived),
    observeArchived: (observer, observeOptions) => {
      archivedObservers.add(observer);
      const unsubscribe = store.observeArchivedThreadsResult((result) => {
        const facts = currentFacts();
        facts.archivedObservedResult = result;
        if (result.value) acknowledgeThreadListSnapshot(facts.archived, result.value);
        observer({
          ...result,
          value: threadListProjection(result.value, facts.archived),
        });
      }, observeOptions);
      return () => {
        archivedObservers.delete(observer);
        unsubscribe();
      };
    },
  };
}

type ThreadListKind = "active" | "archived";

function pendingThreadCatalogFacts(): ThreadCatalogFacts {
  return {
    active: pendingThreadListFacts(),
    archived: pendingThreadListFacts(),
    activeObservedResult: null,
    archivedObservedResult: null,
  };
}

function applyThreadCatalogEvent(
  store: ThreadCatalogEventStore,
  facts: ThreadCatalogFacts,
  event: ThreadCatalogEvent,
): { active: boolean; archived: boolean } {
  const { active: activeFacts, archived: archivedFacts } = facts;
  switch (event.type) {
    case "thread-started":
      upsertActiveThread(activeFacts, event.thread, acknowledgeByThreadId);
      return { active: true, archived: false };
    case "thread-forked":
      upsertActiveThread(activeFacts, event.thread, acknowledgedByThreadVersion(event.thread));
      return { active: true, archived: false };
    case "thread-touched":
      applyThreadTouchedEvent(store, facts, event.threadId, event.recencyAt);
      return { active: true, archived: false };
    case "thread-renamed":
      applyThreadRenamedEvent(store, facts, event.threadId, event.name);
      return { active: true, archived: true };
    case "thread-archived":
      applyThreadArchivedEvent(store, facts, event.threadId);
      return { active: true, archived: true };
    case "thread-deleted":
      applyThreadDeletedEvent(activeFacts, archivedFacts, event.threadId);
      return { active: true, archived: true };
    case "thread-restored":
      applyThreadRestoredEvent(activeFacts, archivedFacts, event.thread);
      return { active: true, archived: true };
    case "thread-unarchived":
      applyThreadUnarchivedEvent(store, facts, event.threadId);
      return { active: true, archived: true };
  }
}

async function loadThreadList(threadsPromise: Promise<readonly Thread[]>, facts: PendingThreadListFacts): Promise<readonly Thread[]> {
  const threads = await threadsPromise;
  acknowledgeThreadListSnapshot(facts, threads);
  return threadListProjection(threads, facts) ?? [];
}

function upsertActiveThread(activeFacts: PendingThreadListFacts, thread: Thread, acknowledgedBy: (thread: Thread) => boolean): void {
  rememberPendingThreadUpsert(activeFacts, thread, acknowledgedBy);
}

function applyThreadTouchedEvent(
  store: ThreadCatalogEventStore,
  facts: ThreadCatalogFacts,
  threadId: string,
  recencyAt: number | null | undefined,
): void {
  const activeFacts = facts.active;
  const existingFact = activeFacts.upserts.get(threadId)?.thread ?? null;
  let touchedThread = existingFact ? touchedActiveThread(existingFact, recencyAt) : null;
  const currentThread =
    threadListProjection(store.activeThreadsSnapshot(), activeFacts)?.find((thread) => thread.id === threadId) ?? touchedThread;
  if (currentThread) touchedThread = touchedActiveThread(currentThread, recencyAt);
  if (!touchedThread) return;
  const promotedThread = touchedThread;
  rememberPendingThreadUpsert(
    activeFacts,
    promotedThread,
    recencyAt === undefined ? acknowledgeByThreadId : acknowledgedByRecency(recencyAt),
  );
}

function applyThreadRenamedEvent(store: ThreadCatalogEventStore, facts: ThreadCatalogFacts, threadId: string, name: string | null): void {
  const { active: activeFacts, archived: archivedFacts } = facts;
  const activeThread = threadListProjection(store.activeThreadsSnapshot(), activeFacts)?.find((thread) => thread.id === threadId) ?? null;
  if (activeThread) rememberPendingThreadUpsert(activeFacts, { ...activeThread, name }, acknowledgedByName(name));
  const archivedThread =
    threadListProjection(store.archivedThreadsSnapshot(), archivedFacts)?.find((thread) => thread.id === threadId) ?? null;
  if (archivedThread) rememberPendingThreadUpsert(archivedFacts, { ...archivedThread, name }, acknowledgedByName(name));
}

function applyThreadArchivedEvent(store: ThreadCatalogEventStore, facts: ThreadCatalogFacts, threadId: string): void {
  const { active: activeFacts, archived: archivedFacts } = facts;
  const archivedThread = threadListProjection(store.activeThreadsSnapshot(), activeFacts)?.find((thread) => thread.id === threadId);
  rememberPendingThreadRemoval(activeFacts, threadId);
  if (archivedThread) {
    const pendingArchivedThread = { ...archivedThread, archived: true };
    rememberPendingThreadUpsert(archivedFacts, pendingArchivedThread, acknowledgeByThreadId);
  } else {
    refreshArchivedThreadsAfterUnknownArchive(store, archivedFacts);
  }
}

function applyThreadDeletedEvent(activeFacts: PendingThreadListFacts, archivedFacts: PendingThreadListFacts, threadId: string): void {
  rememberPendingThreadRemoval(activeFacts, threadId);
  rememberPendingThreadRemoval(archivedFacts, threadId);
}

function applyThreadRestoredEvent(activeFacts: PendingThreadListFacts, archivedFacts: PendingThreadListFacts, thread: Thread): void {
  upsertActiveThread(activeFacts, { ...thread, archived: false }, acknowledgeByThreadId);
  rememberPendingThreadRemoval(archivedFacts, thread.id);
}

function applyThreadUnarchivedEvent(store: ThreadCatalogEventStore, facts: ThreadCatalogFacts, threadId: string): void {
  const { active: activeFacts, archived: archivedFacts } = facts;
  const restoredThread =
    threadListProjection(store.archivedThreadsSnapshot(), archivedFacts)?.find((thread) => thread.id === threadId) ?? null;
  rememberPendingThreadRemoval(archivedFacts, threadId);
  if (restoredThread) {
    upsertActiveThread(activeFacts, { ...restoredThread, archived: false }, acknowledgeByThreadId);
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

function refreshArchivedThreadsAfterUnknownArchive(store: ThreadCatalogEventStore, archivedFacts: PendingThreadListFacts): void {
  // A force refresh can join an older in-flight archived request. Run one more
  // refresh afterward so an archive recorded during that request is not lost.
  void refreshArchivedThreadsTwice(store, archivedFacts);
}

async function refreshArchivedThreadsTwice(store: ThreadCatalogEventStore, archivedFacts: PendingThreadListFacts): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      acknowledgeThreadListSnapshot(archivedFacts, await store.refreshArchivedThreads());
    } catch {
      // The query observer retains the failure for diagnostics; continue so a joined stale request gets one fresh retry.
    }
  }
}

function refreshThreadListsAfterUnknownUnarchive(
  store: ThreadCatalogEventStore,
  activeFacts: PendingThreadListFacts,
  archivedFacts: PendingThreadListFacts,
): void {
  // Unknown unarchives need both lists: active gains the thread, archived loses it.
  void Promise.allSettled([store.refreshActiveThreads(), store.refreshArchivedThreads()]).then(([active, archived]) => {
    if (active.status === "fulfilled") acknowledgeThreadListSnapshot(activeFacts, active.value);
    if (archived.status === "fulfilled") acknowledgeThreadListSnapshot(archivedFacts, archived.value);
  });
}
