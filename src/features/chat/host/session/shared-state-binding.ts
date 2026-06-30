import type { ObservedResult } from "../../../../app-server/query/observed-result";
import { observedValue } from "../../../../app-server/query/observed-result";
import type { ModelMetadata } from "../../../../domain/catalog/metadata";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatStateStore } from "../../application/state/store";
import type { ChatPanelConnectionBundle } from "../bundles/connection-bundle";

type ThreadObserver = (result: ObservedResult<readonly Thread[]>) => void;
type MetadataObserver = (result: ObservedResult<SharedServerMetadata>) => void;
type ModelsObserver = (result: ObservedResult<readonly ModelMetadata[]>) => void;

interface SharedStateThreadCatalog {
  activeSnapshot(): readonly Thread[] | null;
  observeActive(observer: ThreadObserver, options?: { emitCurrent?: boolean }): () => void;
}

interface SharedStateAppServerQueries {
  appServerMetadataSnapshot(): SharedServerMetadata | null;
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeAppServerMetadataResult(observer: MetadataObserver, options?: { emitCurrent?: boolean }): () => void;
  observeModelsResult(observer: ModelsObserver, options?: { emitCurrent?: boolean }): () => void;
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
  serverActions: ChatPanelConnectionBundle["serverActions"];
  refreshTabHeader: () => void;
}

export function createChatPanelSharedStateBinding(options: ChatPanelSharedStateBindingOptions): ChatPanelSharedStateBinding {
  const unsubscribers: (() => void)[] = [];
  const { stateStore, threadCatalog, appServerQueries, serverActions, refreshTabHeader } = options;

  const receiveThreads = (threads: readonly Thread[]): void => {
    serverActions.threads.applyThreadList(threads);
    refreshTabHeader();
  };
  const receiveThreadResult = (result: ObservedResult<readonly Thread[]>): void => {
    const observedThreads = observedValue(result);
    if (observedThreads) receiveThreads(observedThreads);
  };
  const receiveAppServerMetadata = (metadata: SharedServerMetadata): void => {
    serverActions.metadata.applyAppServerMetadata(metadata);
  };
  const receiveAppServerMetadataResult = (result: ObservedResult<SharedServerMetadata>): void => {
    const observedMetadata = observedValue(result);
    if (observedMetadata) receiveAppServerMetadata(observedMetadata);
  };
  const receiveModels = (models: readonly ModelMetadata[]): void => {
    stateStore.dispatch({ type: "connection/metadata-applied", availableModels: models });
  };
  const receiveModelsResult = (result: ObservedResult<readonly ModelMetadata[]>): void => {
    const observedModels = observedValue(result);
    if (observedModels) receiveModels(observedModels);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = threadCatalog.activeSnapshot();
    if (threads) serverActions.threads.applyThreadList(threads);
    const metadata = appServerQueries.appServerMetadataSnapshot();
    if (metadata) serverActions.metadata.applyAppServerMetadata(metadata);
    const models = appServerQueries.modelsSnapshot();
    if (models) receiveModels(models);
  };

  return {
    applyCached,
    subscribe: () => {
      unsubscribe();
      applyCached();
      unsubscribers.push(
        threadCatalog.observeActive(receiveThreadResult, { emitCurrent: false }),
        appServerQueries.observeAppServerMetadataResult(receiveAppServerMetadataResult, { emitCurrent: false }),
        appServerQueries.observeModelsResult(receiveModelsResult, { emitCurrent: false }),
      );
    },
    unsubscribe,
  };
}
