import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";

import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import {
  activeThreadsQueryKey,
  appServerMetadataQueryKey,
  appServerModelsQueryKey,
  appServerQueriesFilter,
  appServerQueryContextIsComplete,
  cloneAppServerQueryContext,
  type AppServerQueryContext,
} from "./keys";
import {
  cloneModelMetadata,
  cloneSharedServerMetadata,
  cloneThreads,
  mergeSharedServerMetadata,
  type SharedServerMetadata,
} from "./snapshots";

export class AppServerQueryCache {
  readonly client: QueryClient;

  constructor(client: QueryClient = createAppServerQueryClient()) {
    this.client = client;
  }

  clear(): void {
    this.client.clear();
  }

  clearContext(context: AppServerQueryContext): void {
    if (!appServerQueryContextIsComplete(context)) return;
    this.client.removeQueries(appServerQueriesFilter(context));
  }

  activeThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const threads = this.client.getQueryData<readonly Thread[]>(activeThreadsQueryKey(context));
    return threads ? cloneThreads(threads) : null;
  }

  observeActiveThreads(
    context: AppServerQueryContext,
    listener: (threads: readonly Thread[]) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQuery(activeThreadsQueryKey(context), cloneThreads, listener, options);
  }

  async fetchActiveThreads(context: AppServerQueryContext, fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return fetchThreads();
    }
    const key = activeThreadsQueryKey(refreshContext);
    const threads = await this.client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const nextThreads = cloneThreads(await fetchThreads());
        return nextThreads;
      },
      staleTime: 0,
    });
    return cloneThreads(threads);
  }

  setActiveThreads(context: AppServerQueryContext, threads: readonly Thread[]): void {
    if (!appServerQueryContextIsComplete(context)) return;
    this.client.setQueryData(activeThreadsQueryKey(context), cloneThreads(threads));
  }

  updateActiveThreads(
    context: AppServerQueryContext,
    updater: (threads: readonly Thread[] | null) => readonly Thread[] | null,
  ): readonly Thread[] | null {
    const current = this.activeThreadsSnapshot(context);
    const next = updater(current);
    if (!next) return null;
    this.setActiveThreads(context, next);
    return cloneThreads(next);
  }

  appServerMetadataSnapshot(context: AppServerQueryContext): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const metadata = this.client.getQueryData<SharedServerMetadata>(appServerMetadataQueryKey(context));
    return metadata ? cloneSharedServerMetadata(metadata) : null;
  }

  observeAppServerMetadata(
    context: AppServerQueryContext,
    listener: (metadata: SharedServerMetadata) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQuery(appServerMetadataQueryKey(context), cloneSharedServerMetadata, listener, options);
  }

  setAppServerMetadata(context: AppServerQueryContext, metadata: SharedServerMetadata): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const previous = this.appServerMetadataSnapshot(context);
    const next = mergeSharedServerMetadata(previous, metadata);
    this.client.setQueryData(appServerMetadataQueryKey(context), cloneSharedServerMetadata(next));
    if (metadata.serverDiagnostics.probes["model/list"].status === "ok") {
      this.client.setQueryData(appServerModelsQueryKey(context), cloneModelMetadata(next.availableModels));
    }
    return cloneSharedServerMetadata(next);
  }

  modelsSnapshot(context: AppServerQueryContext): readonly ModelMetadata[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const models = this.client.getQueryData<readonly ModelMetadata[]>(appServerModelsQueryKey(context));
    return models ? cloneModelMetadata(models) : null;
  }

  observeModels(
    context: AppServerQueryContext,
    listener: (models: readonly ModelMetadata[]) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQuery(appServerModelsQueryKey(context), cloneModelMetadata, listener, options);
  }

  setModels(context: AppServerQueryContext, models: readonly ModelMetadata[]): readonly ModelMetadata[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const clonedModels = cloneModelMetadata(models);
    this.client.setQueryData(appServerModelsQueryKey(context), clonedModels);
    const metadata = this.appServerMetadataSnapshot(context);
    if (metadata) {
      this.client.setQueryData(appServerMetadataQueryKey(context), {
        ...metadata,
        availableModels: cloneModelMetadata(clonedModels),
      });
    }
    return cloneModelMetadata(clonedModels);
  }

  private observeQuery<T>(
    queryKey: readonly unknown[],
    clone: (value: T) => T,
    listener: (value: T) => void,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<T>(this.client, {
      queryKey,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<T>): void => {
      if (result.data !== undefined) listener(clone(result.data));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return unsubscribe;
  }
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
