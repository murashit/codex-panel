import type { SharedServerMetadataResource } from "../../../../domain/server/metadata";
import type { Thread } from "../../../../domain/threads/model";
import type { ObservedPaginatedResult } from "../../../../shared/runtime/observed-result";
import type { ChatStateStore } from "../../application/state/store";

type ThreadObserver = (result: ObservedPaginatedResult<readonly Thread[]>) => void;

interface SharedStateThreadCatalog {
  activeThreadsSnapshot(): readonly Thread[] | null;
  hasMoreActiveThreads(): boolean;
  observeActiveThreadsResult(observer: ThreadObserver, options?: { emitCurrent?: boolean }): () => void;
}

interface SharedStateAppServerQueries {
  observeAppServerMetadataResources(
    observer: (resource: SharedServerMetadataResource) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
}

export interface ChatPanelSharedStateBinding {
  applyCached(): void;
  subscribe(): void;
  unsubscribe(): void;
}

export interface ChatPanelSharedStateBindingOptions {
  stateStore: ChatStateStore;
  threadCatalog: SharedStateThreadCatalog;
  appServerQueries: SharedStateAppServerQueries;
  applyAppServerMetadataResource: (resource: SharedServerMetadataResource) => void;
  refreshTabHeader: () => void;
}

export function createChatPanelSharedStateBinding(options: ChatPanelSharedStateBindingOptions): ChatPanelSharedStateBinding {
  const unsubscribers: (() => void)[] = [];
  const { stateStore, threadCatalog, appServerQueries, applyAppServerMetadataResource, refreshTabHeader } = options;

  const receiveThreads = (
    threads: readonly Thread[],
    hasMore: boolean,
    isFetching: boolean,
    isFetchingNextPage: boolean,
    error: string | null,
  ): void => {
    stateStore.dispatch({ type: "thread-list/applied", threads, hasMore, isFetching, isFetchingNextPage, error });
    refreshTabHeader();
  };
  const receiveThreadResult = (result: ObservedPaginatedResult<readonly Thread[]>): void => {
    const observedThreads = result.value ?? stateStore.getState().threadList.listedThreads;
    receiveThreads(observedThreads, result.hasMore, result.isFetching, result.isFetchingNextPage, result.error?.message ?? null);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = threadCatalog.activeThreadsSnapshot();
    if (threads) {
      stateStore.dispatch({
        type: "thread-list/applied",
        threads,
        hasMore: threadCatalog.hasMoreActiveThreads(),
        isFetching: false,
        isFetchingNextPage: false,
        error: null,
      });
    }
  };

  return {
    applyCached,
    subscribe: () => {
      unsubscribe();
      applyCached();
      unsubscribers.push(
        threadCatalog.observeActiveThreadsResult(receiveThreadResult, { emitCurrent: false }),
        appServerQueries.observeAppServerMetadataResources(applyAppServerMetadataResource),
      );
    },
    unsubscribe,
  };
}
