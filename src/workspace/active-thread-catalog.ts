import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import type { AppServerSharedQueries } from "../app-server/query/shared-queries";
import type { Thread } from "../domain/threads/model";

type ActiveThreadObserver = (result: AppServerObservedQueryResult<readonly Thread[]>) => void;

interface ThreadSurfaceActions {
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ActiveThreadCatalogOptions {
  queries: AppServerSharedQueries;
  surfaces: ThreadSurfaceActions;
}

export interface ActiveThreadCatalogReader {
  snapshot(): readonly Thread[] | null;
  load(): Promise<readonly Thread[]>;
  refresh(): Promise<readonly Thread[]>;
  observe(observer: ActiveThreadObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ActiveThreadCatalogSourceReplacement {
  replaceFromAppServer(threads: readonly Thread[]): void;
}

export interface ActiveThreadCatalogThreadUpserts {
  upsertFromAppServer(thread: Thread): void;
}

export interface ActiveThreadCatalogThreadEvents {
  recordThreadRenamed(threadId: string, name: string | null): void;
  recordThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  recordThreadDeleted(threadId: string): void;
}

export interface ActiveThreadCatalogThreadRestores {
  recordThreadRestored(thread: Thread): void;
}

export interface ActiveThreadCatalog
  extends
    ActiveThreadCatalogReader,
    ActiveThreadCatalogSourceReplacement,
    ActiveThreadCatalogThreadUpserts,
    ActiveThreadCatalogThreadEvents,
    ActiveThreadCatalogThreadRestores {}

export function createActiveThreadCatalog(options: ActiveThreadCatalogOptions): ActiveThreadCatalog {
  return {
    snapshot: () => options.queries.activeThreadsSnapshot(),
    load: () => options.queries.fetchActiveThreads(),
    refresh: () => options.queries.refreshActiveThreads(),
    observe: (observer, observeOptions) => options.queries.observeActiveThreadsResult(observer, observeOptions),
    replaceFromAppServer: (threads) => {
      options.queries.setActiveThreads(threads);
    },
    upsertFromAppServer: (thread) => {
      options.queries.updateActiveThreads((current) => upsertThread(current ?? [], thread));
    },
    recordThreadRenamed: (threadId, name) => {
      options.queries.updateActiveThreads((current) =>
        current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null,
      );
      options.surfaces.applyThreadRenamed(threadId, name);
    },
    recordThreadArchived: (threadId, archiveOptions) => {
      options.queries.updateActiveThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
      options.surfaces.applyThreadArchived(threadId, archiveOptions);
    },
    recordThreadDeleted: (threadId) => {
      options.queries.updateActiveThreads((current) => (current ? current.filter((thread) => thread.id !== threadId) : null));
    },
    recordThreadRestored: (thread) => {
      options.queries.updateActiveThreads((current) => upsertThread(current ?? [], thread));
    },
  };
}

function upsertThread(threads: readonly Thread[], thread: Thread): readonly Thread[] {
  const withoutThread = threads.filter((item) => item.id !== thread.id);
  return [thread, ...withoutThread];
}
