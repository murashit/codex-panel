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
  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogArchivedReader {
  archivedThreadsSnapshot(): readonly Thread[] | null;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  watchArchivedThreads(changed: () => void): ResultObservation<readonly Thread[]>;
}

interface ThreadReplacementPublication {
  attach(replacementThread: Thread): void;
  finish(sourceArchived: boolean): void;
}

export interface ThreadCatalogPublication {
  beginReplacement(sourceThreadId: string): ThreadReplacementPublication;
  visibleThreadId(visibleThreads: readonly Thread[], threadId: string | null): string | null;
}
