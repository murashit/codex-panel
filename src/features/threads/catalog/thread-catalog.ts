import type { BeginThreadReplacement } from "../../../domain/threads/catalog";
import type { Thread } from "../../../domain/threads/model";
import type { ObservedPaginatedResultListener, ResultObservation } from "../../../shared/async/observed-result";

type ActiveThreadListObserver = ObservedPaginatedResultListener<readonly Thread[]>;

export interface ThreadCatalogPaginatedActiveReader {
  activeThreadsSnapshot(): readonly Thread[] | null;
  recentActiveThreadsSnapshot(): readonly Thread[] | null;
  fetchActiveThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<void>;
  observeActiveThreadsResult(observer: ActiveThreadListObserver): () => void;
  hasMoreActiveThreads(): boolean;
  loadMoreActiveThreads(): Promise<void>;
}

export interface ThreadCatalogSearchReader {
  watchActiveThreadSearch(changed: () => void): ResultObservation<readonly Thread[]>;
  fetchActiveThreadSearch(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogArchivedReader {
  archivedThreadsSnapshot(): readonly Thread[] | null;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  watchArchivedThreads(changed: () => void): ResultObservation<readonly Thread[]>;
}

export interface ThreadCatalogPublication {
  beginReplacement: BeginThreadReplacement;
  visibleThreadId(visibleThreads: readonly Thread[], threadId: string | null): string | null;
}
