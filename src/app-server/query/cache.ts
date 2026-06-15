import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";

import type { AppServerClient } from "../connection/client";
import { listModelMetadata } from "../services/catalog";
import { listThreads } from "../services/threads";
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
import { cloneModelMetadata, cloneSharedServerMetadata, cloneThreads, type SharedServerMetadata } from "./snapshots";

const ACTIVE_THREADS_STALE_TIME_MS = 10_000;
const MODELS_STALE_TIME_MS = 60_000;

export interface AppServerQueryClientRunner {
  runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options?: { unhandledServerRequestMessage?: string },
  ): Promise<T>;
}

export class AppServerQueryCache {
  readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
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

  async fetchActiveThreads(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return [];
    }
    const key = activeThreadsQueryKey(refreshContext);
    if (options.force) await this.client.invalidateQueries({ queryKey: key });
    const threads = await this.client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const nextThreads = cloneThreads(
          await this.runWithClient(refreshContext, (client) => listThreads(client, refreshContext.vaultPath)),
        );
        return nextThreads;
      },
      staleTime: ACTIVE_THREADS_STALE_TIME_MS,
    });
    return cloneThreads(threads);
  }

  async refreshActiveThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.fetchActiveThreads(context, { force: true });
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
    const next = cloneSharedServerMetadata({
      ...metadata,
      availableModels:
        metadata.serverDiagnostics.probes["model/list"].status === "ok" ? metadata.availableModels : (this.modelsSnapshot(context) ?? []),
    });
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

  async fetchModels(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly ModelMetadata[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return [];
    }
    const key = appServerModelsQueryKey(refreshContext);
    if (options.force) await this.client.invalidateQueries({ queryKey: key });
    const models = await this.client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        return cloneModelMetadata(
          await this.runWithClient(refreshContext, (client) => listModelMetadata(client), {
            unhandledServerRequestMessage: "Codex model list refresh does not handle server requests.",
          }),
        );
      },
      staleTime: MODELS_STALE_TIME_MS,
    });
    return cloneModelMetadata(models);
  }

  async refreshModels(context: AppServerQueryContext): Promise<readonly ModelMetadata[]> {
    return this.fetchModels(context, { force: true });
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

  private runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options: { unhandledServerRequestMessage?: string } = {},
  ): Promise<T> {
    if (!this.clientRunner) {
      throw new Error("Codex app-server query client runner is not configured.");
    }
    return this.clientRunner.runWithClient(context, operation, options);
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
