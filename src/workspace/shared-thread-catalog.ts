import type { Thread } from "../domain/threads/model";
import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import type { AppServerSharedQueries } from "../app-server/query/shared-queries";

interface ThreadSurfaceActions {
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
}

export interface SharedThreadCatalogOptions {
  queries: AppServerSharedQueries;
  surfaces: ThreadSurfaceActions;
}

export interface SharedThreadCatalog {
  activeThreadsSnapshot(): readonly Thread[] | null;
  fetchActiveThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<readonly Thread[]>;
  setActiveThreads(threads: readonly Thread[]): void;
  observeActiveThreadsResult(
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
  renameThreadInCatalog(threadId: string, name: string | null): void;
  archiveThreadInCatalog(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  refreshThreadsViewLiveState(): void;
}

export function createSharedThreadCatalog(options: SharedThreadCatalogOptions): SharedThreadCatalog {
  return {
    activeThreadsSnapshot: () => options.queries.activeThreadsSnapshot(),
    fetchActiveThreads: () => options.queries.fetchActiveThreads(),
    refreshActiveThreads: () => options.queries.refreshActiveThreads(),
    setActiveThreads: (threads) => {
      options.queries.setActiveThreads(threads);
    },
    observeActiveThreadsResult: (listener, observeOptions) => options.queries.observeActiveThreadsResult(listener, observeOptions),
    renameThreadInCatalog: (threadId, name) => {
      options.queries.updateActiveThreads((current) => {
        return current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null;
      });
      options.surfaces.applyThreadRenamed(threadId, name);
    },
    archiveThreadInCatalog: (threadId, archiveOptions) => {
      options.queries.updateActiveThreads((current) => {
        return current ? current.filter((thread) => thread.id !== threadId) : null;
      });
      options.surfaces.applyThreadArchived(threadId, archiveOptions);
    },
    refreshThreadsViewLiveState: () => {
      options.surfaces.refreshThreadsViewLiveState();
    },
  };
}
