import type { AppServerQueryContextIdentity } from "../../../app-server/query/keys";
import type { ObservedPaginatedResultListener, ObservedResultListener } from "../../../app-server/query/observed-result";
import type { ThreadListMutation } from "../../../app-server/query/thread-list-mutation";
import type { Thread } from "../../../domain/threads/model";

type ActiveThreadListObserver = ObservedPaginatedResultListener<readonly Thread[]>;
type ArchivedThreadListObserver = ObservedResultListener<readonly Thread[]>;

interface ThreadCatalogStore {
  contextKey(): string;
  contextKeyFor(context: AppServerQueryContextIdentity): string;
  activeThreadsSnapshot(): readonly Thread[] | null;
  recentActiveThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]>;
  fetchActiveThreads(): Promise<readonly Thread[]>;
  hasMoreActiveThreads(): boolean;
  loadMoreActiveThreads(): Promise<readonly Thread[]>;
  refreshActiveThreads(): Promise<readonly Thread[]>;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  applyThreadListMutations(mutations: readonly ThreadListMutation[]): void;
  observeActiveThreadsResult(observer: ActiveThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  observeArchivedThreadsResult(observer: ArchivedThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

type ThreadCatalogEventObserver = (event: ThreadCatalogEvent) => void;

export interface ThreadCatalogOptions {
  store: ThreadCatalogStore;
  onEventApplied?: ThreadCatalogEventObserver;
}

export type ThreadCatalogEvent =
  | { type: "thread-upserted"; thread: Thread }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-archived"; threadId: string }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-restored"; thread: Thread }
  | { type: "thread-unarchived"; threadId: string };

export interface ThreadCatalogPaginatedActiveReader {
  activeSnapshot(): readonly Thread[] | null;
  recentActiveSnapshot(): readonly Thread[] | null;
  loadActive(): Promise<readonly Thread[]>;
  refreshActive(): Promise<readonly Thread[]>;
  observeActive(observer: ActiveThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
  hasMoreActive(): boolean;
  loadMoreActive(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogSearchReader {
  searchActive(): Promise<readonly Thread[]>;
}

export interface ThreadCatalogArchivedReader {
  archivedSnapshot(): readonly Thread[] | null;
  refreshArchived(): Promise<readonly Thread[]>;
  observeArchived(observer: ArchivedThreadListObserver, options?: { emitCurrent?: boolean }): () => void;
}

export interface ThreadCatalogEventSink {
  apply(event: ThreadCatalogEvent): void;
}

export interface ThreadCatalogConnectionEventSink {
  applyConnectionEvent(context: AppServerQueryContextIdentity, event: ThreadCatalogEvent): void;
}

export interface ThreadCatalog
  extends ThreadCatalogPaginatedActiveReader,
    ThreadCatalogSearchReader,
    ThreadCatalogArchivedReader,
    ThreadCatalogEventSink,
    ThreadCatalogConnectionEventSink {}

export function createThreadCatalog(options: ThreadCatalogOptions): ThreadCatalog {
  const { store } = options;
  const apply = (event: ThreadCatalogEvent): void => {
    store.applyThreadListMutations(threadListMutationsForEvent(store, event));
    options.onEventApplied?.(event);
  };

  return {
    apply,
    applyConnectionEvent: (context, event) => {
      if (store.contextKeyFor(context) !== store.contextKey()) return;
      apply(event);
    },
    activeSnapshot: () => store.activeThreadsSnapshot(),
    recentActiveSnapshot: () => store.recentActiveThreadsSnapshot(),
    loadActive: () => store.fetchActiveThreads(),
    searchActive: () => store.fetchActiveThreadSearchInventory(),
    refreshActive: () => store.refreshActiveThreads(),
    hasMoreActive: () => store.hasMoreActiveThreads(),
    loadMoreActive: () => store.loadMoreActiveThreads(),
    observeActive: (observer, observeOptions) => store.observeActiveThreadsResult(observer, observeOptions),
    archivedSnapshot: () => store.archivedThreadsSnapshot(),
    refreshArchived: () => store.refreshArchivedThreads(),
    observeArchived: (observer, observeOptions) => store.observeArchivedThreadsResult(observer, observeOptions),
  };
}

function threadListMutationsForEvent(store: ThreadCatalogStore, event: ThreadCatalogEvent): ThreadListMutation[] {
  switch (event.type) {
    case "thread-upserted":
      return [{ kind: "upsert", list: "active", thread: { ...event.thread, archived: false } }];
    case "thread-renamed":
      return [
        { kind: "update", list: "active", threadId: event.threadId, changes: { name: event.name } },
        { kind: "update", list: "archived", threadId: event.threadId, changes: { name: event.name } },
      ];
    case "thread-archived": {
      const thread = threadById(store.activeThreadsSnapshot(), event.threadId);
      return [
        { kind: "remove", list: "active", threadId: event.threadId },
        ...(thread
          ? [{ kind: "upsert", list: "archived", thread: { ...thread, archived: true } } satisfies ThreadListMutation]
          : [{ kind: "refresh", list: "archived" } satisfies ThreadListMutation]),
      ];
    }
    case "thread-deleted":
      return [
        { kind: "remove", list: "active", threadId: event.threadId },
        { kind: "remove", list: "archived", threadId: event.threadId },
      ];
    case "thread-restored":
      return [
        { kind: "upsert", list: "active", thread: { ...event.thread, archived: false } },
        { kind: "remove", list: "archived", threadId: event.thread.id },
      ];
    case "thread-unarchived": {
      const thread = threadById(store.archivedThreadsSnapshot(), event.threadId);
      return [
        { kind: "remove", list: "archived", threadId: event.threadId },
        ...(thread
          ? [{ kind: "upsert", list: "active", thread: { ...thread, archived: false } } satisfies ThreadListMutation]
          : [{ kind: "refresh", list: "active" } satisfies ThreadListMutation]),
      ];
    }
  }
}

function threadById(threads: readonly Thread[] | null, threadId: string): Thread | null {
  return threads?.find((thread) => thread.id === threadId) ?? null;
}
