import type { Thread } from "../../../../src/domain/threads/model";
import type { ChatMetadataSource, ChatThreadGoalQueries } from "../../../../src/features/chat/host/contracts";
import type { ChatToolInventoryDisplayQueries } from "../../../../src/features/chat/host/shell/shared-resource-hooks";
import type { ThreadCatalogPaginatedActiveReader } from "../../../../src/features/threads/catalog/thread-catalog";

export function chatSharedSourcesFixture(threads: readonly Thread[] = []): {
  metadata: ChatMetadataSource;
  toolInventoryQueries: ChatToolInventoryDisplayQueries;
  threadGoalQueries: ChatThreadGoalQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
} {
  return {
    metadata: {
      observeMetadataResource: () => () => undefined,
    },
    toolInventoryQueries: {
      observe: (_threadId, listener) => {
        listener(null);
        return () => undefined;
      },
    },
    threadGoalQueries: {
      snapshot: () => null,
      observe: (_threadId, listener) => {
        listener(null, null);
        return () => undefined;
      },
      observeChanges: () => () => undefined,
    },
    threadCatalog: {
      fetchActiveThreads: async () => threads,
      refreshActiveThreads: async () => undefined,
      activeThreadsSnapshot: () => threads,
      recentActiveThreadsSnapshot: () => threads,
      hasMoreActiveThreads: () => false,
      loadMoreActiveThreads: async () => undefined,
      observeActiveThreadsResult: (listener) => {
        listener({
          value: threads,
          isFetching: false,
          isFetchingNextPage: false,
          hasMore: false,
          error: null,
        });
        return () => undefined;
      },
    },
  };
}
