import type { ThreadCatalogChange } from "../../../domain/threads/catalog-read-model";
import type { Thread } from "../../../domain/threads/model";
import type { ObservedPaginatedResultListener, ObservedResultListener } from "../../../shared/runtime/observed-result";

type ActiveThreadListObserver = ObservedPaginatedResultListener<readonly Thread[]>;
type ArchivedThreadListObserver = ObservedResultListener<readonly Thread[]>;

export interface ThreadCatalogPaginatedActiveReader {
  activeThreadsSnapshot(): readonly Thread[] | null;
  recentActiveThreadsSnapshot(): readonly Thread[] | null;
  fetchActiveThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<readonly Thread[]>;
  observeActiveThreadsResult(observer: ActiveThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  hasMoreActiveThreads(): boolean;
  loadMoreActiveThreads(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogSearchReader {
  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogArchivedReader {
  archivedThreadsSnapshot(): readonly Thread[] | null;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  observeArchivedThreadsResult(observer: ArchivedThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

interface ThreadCatalogWriter {
  applyThreadCatalogChanges(changes: readonly ThreadCatalogChange[]): void;
}

export interface ThreadCatalog
  extends ThreadCatalogPaginatedActiveReader,
    ThreadCatalogSearchReader,
    ThreadCatalogArchivedReader,
    ThreadCatalogWriter {}
