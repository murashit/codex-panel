import type { ObservedDataListener } from "../domain/observed-data";
import type { Thread } from "../domain/threads/model";

type ThreadListObserver = ObservedDataListener<readonly Thread[]>;

interface ThreadCatalogQuerySource {
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

interface ThreadSurfaceActions {
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ThreadCatalogOptions {
  queries: ThreadCatalogQuerySource;
  surfaces: ThreadSurfaceActions;
}

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

export interface ThreadCatalogSnapshotWriter {
  replaceActiveThreadsSnapshot(threads: readonly Thread[]): void;
  replaceArchivedThreadsSnapshot(threads: readonly Thread[]): void;
}

interface ThreadCatalogThreadStarts {
  recordThreadStarted(thread: Thread): void;
}

interface ThreadCatalogThreadForks {
  recordThreadForked(thread: Thread): void;
}

interface ThreadCatalogThreadTouches {
  recordThreadTouched(threadId: string, recencyAt?: number | null): void;
}

interface ThreadCatalogThreadRenames {
  recordThreadRenamed(threadId: string, name: string | null): void;
}

interface ThreadCatalogThreadArchives {
  recordThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
}

export interface ThreadCatalogThreadDeletes {
  recordThreadDeleted(threadId: string): void;
}

export interface ThreadCatalogThreadRestores {
  recordThreadRestored(thread: Thread): void;
}

export interface ThreadCatalogChatEvents
  extends
    ThreadCatalogThreadStarts,
    ThreadCatalogThreadForks,
    ThreadCatalogThreadTouches,
    ThreadCatalogThreadRenames,
    ThreadCatalogThreadArchives,
    ThreadCatalogThreadDeletes {}

export interface ThreadCatalogThreadManagementEvents extends ThreadCatalogThreadRenames, ThreadCatalogThreadArchives {}

export interface ThreadCatalog
  extends
    ThreadCatalogActiveReader,
    ThreadCatalogArchivedReader,
    ThreadCatalogSnapshotWriter,
    ThreadCatalogChatEvents,
    ThreadCatalogThreadRestores {}

export function createThreadCatalog(options: ThreadCatalogOptions): ThreadCatalog {
  const activeLifecycleFacts = new Map<string, Thread>();

  return {
    activeSnapshot: () => activeThreadsProjection(options.queries.activeThreadsSnapshot(), activeLifecycleFacts),
    loadActive: () => loadActiveThreads(options.queries.fetchActiveThreads(), activeLifecycleFacts),
    refreshActive: () => loadActiveThreads(options.queries.refreshActiveThreads(), activeLifecycleFacts),
    observeActive: (observer, observeOptions) =>
      options.queries.observeActiveThreadsResult((result) => {
        observer({
          ...result,
          data: activeThreadsProjection(result.data, activeLifecycleFacts),
        });
      }, observeOptions),
    archivedSnapshot: () => options.queries.archivedThreadsSnapshot(),
    loadArchived: () => options.queries.fetchArchivedThreads(),
    refreshArchived: () => options.queries.refreshArchivedThreads(),
    observeArchived: (observer, observeOptions) => options.queries.observeArchivedThreadsResult(observer, observeOptions),
    replaceActiveThreadsSnapshot: (threads) => {
      activeLifecycleFacts.clear();
      options.queries.setActiveThreads(threads);
    },
    replaceArchivedThreadsSnapshot: (threads) => {
      options.queries.setArchivedThreads(threads);
    },
    recordThreadStarted: (thread) => {
      recordActiveThread(options.queries, activeLifecycleFacts, thread);
    },
    recordThreadForked: (thread) => {
      recordActiveThread(options.queries, activeLifecycleFacts, thread);
    },
    recordThreadTouched: (threadId, recencyAt) => {
      recordActiveThreadTouched(options.queries, activeLifecycleFacts, threadId, recencyAt);
    },
    recordThreadRenamed: (threadId, name) => {
      updateActiveLifecycleFact(activeLifecycleFacts, threadId, (thread) => ({ ...thread, name }));
      options.queries.updateActiveThreads((current) =>
        current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null,
      );
      options.surfaces.applyThreadRenamed(threadId, name);
    },
    recordThreadArchived: (threadId, archiveOptions) => {
      activeLifecycleFacts.delete(threadId);
      const archivedThread = options.queries.activeThreadsSnapshot()?.find((thread) => thread.id === threadId) ?? null;
      options.queries.updateActiveThreads((current) => {
        return current ? current.filter((thread) => thread.id !== threadId) : null;
      });
      if (archivedThread) {
        options.queries.updateArchivedThreads((current) => promoteThreadInList(current ?? [], { ...archivedThread, archived: true }));
      } else {
        refreshArchivedThreadsAfterUnknownArchive(options.queries);
      }
      options.surfaces.applyThreadArchived(threadId, archiveOptions);
    },
    recordThreadDeleted: (threadId) => {
      activeLifecycleFacts.delete(threadId);
      options.queries.updateActiveThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
      options.queries.updateArchivedThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
    },
    recordThreadRestored: (thread) => {
      recordActiveThread(options.queries, activeLifecycleFacts, thread);
      options.queries.updateArchivedThreads((current) => (current ? current.filter((item) => item.id !== thread.id) : null));
    },
  };
}

async function loadActiveThreads(
  threadsPromise: Promise<readonly Thread[]>,
  activeLifecycleFacts: Map<string, Thread>,
): Promise<readonly Thread[]> {
  const threads = await threadsPromise;
  acknowledgeActiveSnapshot(activeLifecycleFacts, threads);
  return activeThreadsProjection(threads, activeLifecycleFacts) ?? [];
}

function recordActiveThread(queries: ThreadCatalogQuerySource, activeLifecycleFacts: Map<string, Thread>, thread: Thread): void {
  promoteActiveLifecycleFact(activeLifecycleFacts, thread);
  queries.updateActiveThreads((current) => promoteThreadInList(current ?? [], thread));
}

function recordActiveThreadTouched(
  queries: ThreadCatalogQuerySource,
  activeLifecycleFacts: Map<string, Thread>,
  threadId: string,
  recencyAt: number | null | undefined,
): void {
  const existingFact = activeLifecycleFacts.get(threadId) ?? null;
  let touchedThread = existingFact ? touchedActiveThread(existingFact, recencyAt) : null;
  const nextThreads = queries.updateActiveThreads((current) => {
    const currentThread = current?.find((thread) => thread.id === threadId) ?? touchedThread;
    if (!currentThread) return current;
    touchedThread = touchedActiveThread(currentThread, recencyAt);
    return promoteThreadInList(current ?? [], touchedThread);
  });
  if (!touchedThread) return;
  const promotedThread = touchedThread;
  promoteActiveLifecycleFact(activeLifecycleFacts, promotedThread);
  if (!nextThreads) {
    queries.updateActiveThreads(() => [promotedThread]);
  }
}

function activeThreadsProjection(
  snapshot: readonly Thread[] | null,
  activeLifecycleFacts: ReadonlyMap<string, Thread>,
): readonly Thread[] | null {
  if (!snapshot && activeLifecycleFacts.size === 0) return null;
  const threads = snapshot ?? [];
  if (activeLifecycleFacts.size === 0) return threads;
  const snapshotThreadIds = new Set(threads.map((thread) => thread.id));
  const missingFactThreads = Array.from(activeLifecycleFacts.values()).filter((thread) => !snapshotThreadIds.has(thread.id));
  if (missingFactThreads.length === 0) return threads;
  return [...missingFactThreads.reverse(), ...threads];
}

function acknowledgeActiveSnapshot(activeLifecycleFacts: Map<string, Thread>, threads: readonly Thread[]): void {
  for (const thread of threads) {
    activeLifecycleFacts.delete(thread.id);
  }
}

function promoteActiveLifecycleFact(activeLifecycleFacts: Map<string, Thread>, thread: Thread): void {
  activeLifecycleFacts.delete(thread.id);
  activeLifecycleFacts.set(thread.id, thread);
}

function updateActiveLifecycleFact(activeLifecycleFacts: Map<string, Thread>, threadId: string, updater: (thread: Thread) => Thread): void {
  const thread = activeLifecycleFacts.get(threadId);
  if (!thread) return;
  promoteActiveLifecycleFact(activeLifecycleFacts, updater(thread));
}

function touchedActiveThread(thread: Thread, recencyAt: number | null | undefined): Thread {
  return recencyAt === undefined ? thread : { ...thread, recencyAt };
}

function promoteThreadInList(threads: readonly Thread[], thread: Thread): readonly Thread[] {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return [thread, ...withoutThread];
}

function refreshArchivedThreadsAfterUnknownArchive(queries: ThreadCatalogQuerySource): void {
  // A force refresh can join an older in-flight archived request. Run one more
  // refresh afterward so an archive recorded during that request is not lost.
  void queries
    .refreshArchivedThreads()
    .then(() => queries.refreshArchivedThreads())
    .catch(() => undefined);
}
