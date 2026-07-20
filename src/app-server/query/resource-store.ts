import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import { AppServerQueryCache, type AppServerQueryClientRunner } from "./cache";
import type { AppServerQueryContext } from "./keys";
import type { ObservedPaginatedResultListener, ObservedResultListener } from "./observed-result";
import type { ThreadListMutation } from "./thread-list-mutation";

export interface AppServerResourceStoreOptions {
  context: AppServerQueryContext;
  cacheFactory?: (context: AppServerQueryContext) => AppServerQueryCache;
  clientRunner?: AppServerQueryClientRunner;
}

export class StaleAppServerResourceContextError extends Error {
  constructor() {
    super("Codex app-server resource context changed while loading.");
    this.name = "StaleAppServerResourceContextError";
  }
}

export function isStaleAppServerResourceContextError(error: unknown): error is StaleAppServerResourceContextError {
  return error instanceof StaleAppServerResourceContextError;
}

interface ResourceObserver<T> {
  readonly observe: (cache: AppServerQueryCache, listener: (value: T) => void, options: { emitCurrent?: boolean }) => () => void;
  readonly listener: (value: T) => void;
  readonly options: { emitCurrent?: boolean };
  unsubscribeQuery: (() => void) | null;
}

export class AppServerResourceStore {
  private readonly observers = new Set<ResourceObserver<unknown>>();
  private cache: AppServerQueryCache | null;
  private disposed = false;

  constructor(options: AppServerResourceStoreOptions) {
    const cacheFactory =
      options.cacheFactory ??
      ((context) => new AppServerQueryCache(context, options.clientRunner ? { clientRunner: options.clientRunner } : {}));
    this.cache = cacheFactory(Object.freeze({ ...options.context }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeObservers();
    this.cache?.dispose();
    this.cache = null;
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.cache?.activeThreadsSnapshot() ?? null;
  }

  recentActiveThreadsSnapshot(): readonly Thread[] | null {
    return this.cache?.recentActiveThreadsSnapshot() ?? null;
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.cache?.archivedThreadsSnapshot() ?? null;
  }

  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.fetchActiveThreadSearchInventory());
  }

  hasMoreActiveThreads(): boolean {
    return this.cache?.hasMoreActiveThreads() ?? false;
  }

  loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.loadMoreActiveThreads());
  }

  fetchActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.fetchActiveThreads());
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.refreshActiveThreads());
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.refreshArchivedThreads());
  }

  applyThreadListMutations(mutations: readonly ThreadListMutation[]): void {
    this.currentCache().applyThreadListMutations(mutations);
  }

  observeActiveThreadsResult(
    listener: ObservedPaginatedResultListener<readonly Thread[]>,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observeCurrentContext(
      (cache, contextListener, observeOptions) => cache.observeActiveThreadsResult(contextListener, observeOptions),
      listener,
      options,
    );
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (cache, contextListener, observeOptions) => cache.observeArchivedThreadsResult(contextListener, observeOptions),
      listener,
      options,
    );
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.cache?.appServerMetadataSnapshot() ?? null;
  }

  refreshAppServerMetadata(): Promise<void> {
    return this.runForCurrentContext((cache) => cache.refreshAppServerMetadata());
  }

  refreshSkills(): Promise<void> {
    return this.runForCurrentContext((cache) => cache.refreshSkills());
  }

  refreshRateLimits(): Promise<void> {
    return this.runForCurrentContext((cache) => cache.refreshRateLimits());
  }

  observeAppServerMetadataResources(
    listener: (resource: SharedServerMetadataResource) => void,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observeCurrentContext(
      (cache, contextListener, observeOptions) => cache.observeAppServerMetadataResources(contextListener, observeOptions),
      listener,
      options,
    );
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    return this.cache?.modelsSnapshot() ?? null;
  }

  fetchModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((cache) => cache.fetchModels());
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((cache) => cache.refreshModels());
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (cache, contextListener, observeOptions) => cache.observeModelsResult(contextListener, observeOptions),
      listener,
      options,
    );
  }

  private runForCurrentContext<T>(operation: (cache: AppServerQueryCache) => Promise<T>): Promise<T> {
    const cache = this.currentCache();
    return this.runWhileActive(cache, () => operation(cache));
  }

  private async runWhileActive<T>(cache: AppServerQueryCache, operation: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (this.cache !== cache) throw new StaleAppServerResourceContextError();
      throw error;
    }
    if (this.cache !== cache) throw new StaleAppServerResourceContextError();
    return result;
  }

  private observeCurrentContext<T>(
    observe: ResourceObserver<T>["observe"],
    listener: ResourceObserver<T>["listener"],
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    const observer: ResourceObserver<T> = {
      observe,
      listener,
      options,
      unsubscribeQuery: null,
    };
    this.observers.add(observer as ResourceObserver<unknown>);
    this.bindObserver(observer);
    return () => {
      this.observers.delete(observer as ResourceObserver<unknown>);
      observer.unsubscribeQuery?.();
      observer.unsubscribeQuery = null;
    };
  }

  private bindObserver<T>(observer: ResourceObserver<T>): void {
    if (this.disposed || !this.cache) return;
    const cache = this.cache;
    const observeOptions: { emitCurrent?: boolean } = {};
    if (observer.options.emitCurrent !== undefined) observeOptions.emitCurrent = observer.options.emitCurrent;
    observer.unsubscribeQuery = observer.observe(
      cache,
      (value) => {
        if (!this.disposed) observer.listener(value);
      },
      observeOptions,
    );
  }

  private unsubscribeObservers(): void {
    for (const observer of this.observers) {
      observer.unsubscribeQuery?.();
      observer.unsubscribeQuery = null;
    }
  }

  private currentCache(): AppServerQueryCache {
    if (!this.cache) throw new Error("Codex app-server resource store is not initialized.");
    return this.cache;
  }
}
