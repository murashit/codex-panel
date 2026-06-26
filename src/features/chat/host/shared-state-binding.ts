import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { ObservedDataResult } from "../../../domain/observed-data";
import { observedData } from "../../../domain/observed-data";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { ChatStateStore } from "../application/state/store";
import type { ChatPanelConnectionBundle } from "./connection-bundle";

type ThreadObserver = (result: ObservedDataResult<readonly Thread[]>) => void;
type MetadataObserver = (result: ObservedDataResult<SharedServerMetadata>) => void;
type ModelsObserver = (result: ObservedDataResult<readonly ModelMetadata[]>) => void;

interface SharedStateThreadCatalog {
  activeSnapshot(): readonly Thread[] | null;
  observeActive(observer: ThreadObserver, options?: { emitCurrent?: boolean }): () => void;
}

interface SharedStateAppServerData {
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
  appServerData: SharedStateAppServerData;
  serverActions: ChatPanelConnectionBundle["serverActions"];
  refreshTabHeader: () => void;
}

export function createChatPanelSharedStateBinding(options: ChatPanelSharedStateBindingOptions): ChatPanelSharedStateBinding {
  const unsubscribers: (() => void)[] = [];
  const { stateStore, threadCatalog, appServerData, serverActions, refreshTabHeader } = options;

  const receiveThreads = (threads: readonly Thread[]): void => {
    serverActions.threads.applyThreadList(threads);
    refreshTabHeader();
  };
  const receiveThreadResult = (result: ObservedDataResult<readonly Thread[]>): void => {
    const data = observedData(result);
    if (data) receiveThreads(data);
  };
  const receiveAppServerMetadata = (metadata: SharedServerMetadata): void => {
    serverActions.metadata.applyAppServerMetadata(metadata);
  };
  const receiveAppServerMetadataResult = (result: ObservedDataResult<SharedServerMetadata>): void => {
    const data = observedData(result);
    if (data) receiveAppServerMetadata(data);
  };
  const receiveModels = (models: readonly ModelMetadata[]): void => {
    stateStore.dispatch({ type: "connection/metadata-applied", availableModels: models });
  };
  const receiveModelsResult = (result: ObservedDataResult<readonly ModelMetadata[]>): void => {
    const data = observedData(result);
    if (data) receiveModels(data);
  };
  const unsubscribe = (): void => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  };
  const applyCached = (): void => {
    const threads = threadCatalog.activeSnapshot();
    if (threads) serverActions.threads.applyThreadList(threads);
    const metadata = appServerData.appServerMetadataSnapshot();
    if (metadata) serverActions.metadata.applyAppServerMetadata(metadata);
    const models = appServerData.modelsSnapshot();
    if (models) receiveModels(models);
  };

  return {
    applyCached,
    subscribe: () => {
      unsubscribe();
      applyCached();
      unsubscribers.push(
        threadCatalog.observeActive(receiveThreadResult, { emitCurrent: false }),
        appServerData.observeAppServerMetadataResult(receiveAppServerMetadataResult, { emitCurrent: false }),
        appServerData.observeModelsResult(receiveModelsResult, { emitCurrent: false }),
      );
    },
    unsubscribe,
  };
}
