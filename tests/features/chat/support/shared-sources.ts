import type { Thread } from "../../../../src/domain/threads/model";
import type { ChatSharedResourceQueries } from "../../../../src/features/chat/panel/shell/shared-resources";
import type { ThreadCatalogPaginatedActiveReader } from "../../../../src/features/threads/catalog/thread-catalog";

export function chatSharedSourcesFixture(threads: readonly Thread[] = []): {
  appServerQueries: ChatSharedResourceQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
} {
  return {
    appServerQueries: {
      observeAppServerMetadataResources: () => () => undefined,
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
