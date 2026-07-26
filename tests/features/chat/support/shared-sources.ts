import type { Thread } from "../../../../src/domain/threads/model";
import type { ChatSharedDisplayQueries } from "../../../../src/features/chat/panel/shell/shared-resource-hooks";
import type { ThreadCatalogPaginatedActiveReader } from "../../../../src/features/threads/catalog/thread-catalog";

export function chatSharedSourcesFixture(threads: readonly Thread[] = []): {
  appServerQueries: ChatSharedDisplayQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
} {
  return {
    appServerQueries: {
      observeMetadataResource: () => () => undefined,
    },
    threadCatalog: {
      fetchActiveThreads: async () => threads,
      refreshActiveThreads: async () => threads,
      activeThreadsSnapshot: () => threads,
      recentActiveThreadsSnapshot: () => threads,
      hasMoreActiveThreads: () => false,
      loadMoreActiveThreads: async () => threads,
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
