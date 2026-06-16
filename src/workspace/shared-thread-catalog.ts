import type { Thread } from "../domain/threads/model";
import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import type { AppServerSharedQueries } from "../app-server/query/shared-queries";

interface ThreadSurfaceActions {
  invalidateThreadsFromOpenSurface(): void;
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
}

export interface SharedThreadCatalogOptions {
  queries: AppServerSharedQueries;
  surfaces: ThreadSurfaceActions;
}

export class SharedThreadCatalog {
  constructor(private readonly options: SharedThreadCatalogOptions) {}

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.options.queries.activeThreadsSnapshot();
  }

  async fetchActiveThreads(): Promise<readonly Thread[]> {
    return this.options.queries.fetchActiveThreads();
  }

  async refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.options.queries.refreshActiveThreads();
  }

  setActiveThreads(threads: readonly Thread[]): void {
    this.options.queries.setActiveThreads(threads);
  }

  observeActiveThreadsResult(
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.options.queries.observeActiveThreadsResult(listener, options);
  }

  invalidateThreadsFromOpenSurface(): void {
    this.options.surfaces.invalidateThreadsFromOpenSurface();
  }

  renameThreadInCatalog(threadId: string, name: string | null): void {
    this.options.queries.updateActiveThreads((current) => {
      return current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null;
    });
    this.options.surfaces.applyThreadRenamed(threadId, name);
  }

  archiveThreadInCatalog(threadId: string, options?: { closeOpenPanels?: boolean }): void {
    this.options.queries.updateActiveThreads((current) => {
      return current ? current.filter((thread) => thread.id !== threadId) : null;
    });
    this.options.surfaces.applyThreadArchived(threadId, options);
  }

  refreshThreadsViewLiveState(): void {
    this.options.surfaces.refreshThreadsViewLiveState();
  }
}
