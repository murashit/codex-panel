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
  return {
    activeSnapshot: () => options.queries.activeThreadsSnapshot(),
    loadActive: () => options.queries.fetchActiveThreads(),
    refreshActive: () => options.queries.refreshActiveThreads(),
    observeActive: (observer, observeOptions) => options.queries.observeActiveThreadsResult(observer, observeOptions),
    archivedSnapshot: () => options.queries.archivedThreadsSnapshot(),
    loadArchived: () => options.queries.fetchArchivedThreads(),
    refreshArchived: () => options.queries.refreshArchivedThreads(),
    observeArchived: (observer, observeOptions) => options.queries.observeArchivedThreadsResult(observer, observeOptions),
    replaceActiveThreadsSnapshot: (threads) => {
      options.queries.setActiveThreads(threads);
    },
    replaceArchivedThreadsSnapshot: (threads) => {
      options.queries.setArchivedThreads(threads);
    },
    recordThreadStarted: (thread) => {
      recordActiveThread(options.queries, thread);
    },
    recordThreadForked: (thread) => {
      recordActiveThread(options.queries, thread);
    },
    recordThreadRenamed: (threadId, name) => {
      options.queries.updateActiveThreads((current) =>
        current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null,
      );
      options.surfaces.applyThreadRenamed(threadId, name);
    },
    recordThreadArchived: (threadId, archiveOptions) => {
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
      options.queries.updateActiveThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
      options.queries.updateArchivedThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
    },
    recordThreadRestored: (thread) => {
      recordActiveThread(options.queries, thread);
      options.queries.updateArchivedThreads((current) => (current ? current.filter((item) => item.id !== thread.id) : null));
    },
  };
}

function recordActiveThread(queries: ThreadCatalogQuerySource, thread: Thread): void {
  queries.updateActiveThreads((current) => promoteThreadInList(current ?? [], thread));
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
