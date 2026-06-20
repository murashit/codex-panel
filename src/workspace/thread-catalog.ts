import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import type { AppServerSharedQueries } from "../app-server/query/shared-queries";
import type { Thread } from "../domain/threads/model";

type ThreadListObserver = (result: AppServerObservedQueryResult<readonly Thread[]>) => void;

interface ThreadSurfaceActions {
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ThreadCatalogOptions {
  queries: AppServerSharedQueries;
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

export interface ThreadCatalogSourceReplacement {
  replaceActiveFromAppServer(threads: readonly Thread[]): void;
  replaceArchivedFromAppServer(threads: readonly Thread[]): void;
}

export interface ThreadCatalogThreadUpserts {
  upsertActiveFromAppServer(thread: Thread): void;
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

export interface ThreadCatalogThreadEvents extends ThreadCatalogThreadRenames, ThreadCatalogThreadArchives, ThreadCatalogThreadDeletes {}

export interface ThreadCatalog
  extends
    ThreadCatalogActiveReader,
    ThreadCatalogArchivedReader,
    ThreadCatalogSourceReplacement,
    ThreadCatalogThreadUpserts,
    ThreadCatalogThreadEvents,
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
    replaceActiveFromAppServer: (threads) => {
      options.queries.setActiveThreads(threads);
    },
    replaceArchivedFromAppServer: (threads) => {
      options.queries.setArchivedThreads(threads);
    },
    upsertActiveFromAppServer: (thread) => {
      options.queries.updateActiveThreads((current) => upsertThread(current ?? [], thread));
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
        options.queries.updateArchivedThreads((current) => upsertThread(current ?? [], { ...archivedThread, archived: true }));
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
      options.queries.updateActiveThreads((current) => upsertThread(current ?? [], thread));
      options.queries.updateArchivedThreads((current) => (current ? current.filter((item) => item.id !== thread.id) : null));
    },
  };
}

function upsertThread(threads: readonly Thread[], thread: Thread): readonly Thread[] {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return [thread, ...withoutThread];
}

function refreshArchivedThreadsAfterUnknownArchive(queries: AppServerSharedQueries): void {
  // A force refresh can join an older in-flight archived request. Run one more
  // refresh afterward so an archive recorded during that request is not lost.
  void queries
    .refreshArchivedThreads()
    .then(() => queries.refreshArchivedThreads())
    .catch(() => undefined);
}
