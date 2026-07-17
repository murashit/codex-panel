import type { ObservedResult } from "../../../../app-server/query/observed-result";
import type { SharedServerMetadataResource } from "../../../../domain/server/metadata";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatStateStore } from "../../application/state/store";

type ThreadObserver = (result: ObservedResult<readonly Thread[]>) => void;

interface SharedStateThreadCatalog {
  activeSnapshot(): readonly Thread[] | null;
  observeActive(observer: ThreadObserver, options?: { emitCurrent?: boolean }): () => void;
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

  const receiveThreads = (threads: readonly Thread[]): void => {
    stateStore.dispatch({ type: "thread-list/applied", threads });
    refreshTabHeader();
  };
  const receiveThreadResult = (result: ObservedResult<readonly Thread[]>): void => {
    const observedThreads = result.value;
    if (observedThreads) receiveThreads(observedThreads);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = threadCatalog.activeSnapshot();
    if (threads) stateStore.dispatch({ type: "thread-list/applied", threads });
  };

  return {
    applyCached,
    subscribe: () => {
      unsubscribe();
      applyCached();
      unsubscribers.push(
        threadCatalog.observeActive(receiveThreadResult, { emitCurrent: false }),
        appServerQueries.observeAppServerMetadataResources(applyAppServerMetadataResource),
      );
    },
    unsubscribe,
  };
}
