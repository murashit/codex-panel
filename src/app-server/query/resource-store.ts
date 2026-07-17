import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import { AppServerQueryCache, type AppServerQueryClientRunner } from "./cache";
import {
  type AppServerContextLease,
  type AppServerQueryContext,
  type AppServerQueryContextIdentity,
  appServerQueryContextIdentity,
  appServerQueryContextIdentityKey,
  appServerQueryContextIdentityMatches,
  appServerQueryContextRawEquals,
  createAppServerContextLease,
} from "./keys";
import type { ObservedResultListener } from "./observed-result";

export interface AppServerResourceStoreOptions {
  cacheFactory?: (context: AppServerQueryContextIdentity) => AppServerQueryCache;
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
  firstSubscribe: boolean;
  unsubscribeQuery: (() => void) | null;
}

export class AppServerResourceStore {
  private readonly observers = new Set<ResourceObserver<unknown>>();
  private readonly cacheFactory: (context: AppServerQueryContextIdentity) => AppServerQueryCache;
  private cache: AppServerQueryCache | null = null;
  private lease: AppServerContextLease | null = null;
  private generation = 0;

  constructor(options: AppServerResourceStoreOptions = {}) {
    this.cacheFactory =
      options.cacheFactory ??
      ((context) => new AppServerQueryCache(context, options.clientRunner ? { clientRunner: options.clientRunner } : {}));
  }

  initialize(context: AppServerQueryContext): AppServerContextLease {
    if (this.lease) throw new Error("Codex app-server resource store is already initialized.");
    this.lease = this.nextLease(context);
    this.cache = this.cacheFactory(this.contextIdentity());
    this.rebindObservers();
    return this.lease;
  }

  replaceContext(context: AppServerQueryContext): AppServerContextLease {
    if (!this.lease) throw new Error("Codex app-server resource store is not initialized.");
    if (appServerQueryContextRawEquals(this.lease.context, context)) return this.lease;
    this.unsubscribeObservers();
    this.cache?.dispose();
    this.lease = this.nextLease(context);
    this.cache = this.cacheFactory(this.contextIdentity());
    this.rebindObservers();
    return this.lease;
  }

  reset(): void {
    this.unsubscribeObservers();
    this.cache?.dispose();
    this.cache = null;
    this.lease = null;
  }

  contextLease(): AppServerContextLease {
    if (!this.lease) throw new Error("Codex app-server resource store is not initialized.");
    return this.lease;
  }

  contextIdentity(): AppServerQueryContextIdentity {
    return appServerQueryContextIdentity(this.contextLease());
  }

  contextKey(): string {
    return appServerQueryContextIdentityKey(this.contextIdentity());
  }

  contextKeyFor(context: AppServerQueryContextIdentity): string {
    return appServerQueryContextIdentityKey(context);
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.cache?.activeThreadsSnapshot() ?? null;
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.cache?.archivedThreadsSnapshot() ?? null;
  }

  fetchAllActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.fetchAllActiveThreads());
  }

  hasMoreActiveThreads(): boolean {
    return this.cache?.hasMoreActiveThreads() ?? false;
  }

  loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.loadMoreActiveThreads());
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.refreshActiveThreads());
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.refreshArchivedThreads());
  }

  observeActiveThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
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

  private nextLease(context: AppServerQueryContext): AppServerContextLease {
    return createAppServerContextLease(context, ++this.generation);
  }

  private isCurrent(context: AppServerQueryContextIdentity): boolean {
    return Boolean(this.lease && appServerQueryContextIdentityMatches(this.contextIdentity(), context));
  }

  private runForCurrentContext<T>(operation: (cache: AppServerQueryCache) => Promise<T>): Promise<T> {
    const context = this.contextIdentity();
    const cache = this.currentCache();
    return this.runForIdentity(context, () => operation(cache));
  }

  private async runForIdentity<T>(context: AppServerQueryContextIdentity, operation: () => Promise<T>): Promise<T> {
    if (!this.isCurrent(context)) throw new StaleAppServerResourceContextError();
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (!this.isCurrent(context)) throw new StaleAppServerResourceContextError();
      throw error;
    }
    if (!this.isCurrent(context)) throw new StaleAppServerResourceContextError();
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
      firstSubscribe: true,
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
    if (!this.lease || !this.cache) return;
    const context = this.contextIdentity();
    const cache = this.cache;
    const observeOptions: { emitCurrent?: boolean } = {};
    if (observer.firstSubscribe) {
      if (observer.options.emitCurrent !== undefined) observeOptions.emitCurrent = observer.options.emitCurrent;
    } else {
      observeOptions.emitCurrent = true;
    }
    observer.unsubscribeQuery = observer.observe(
      cache,
      (value) => {
        if (this.isCurrent(context)) observer.listener(value);
      },
      observeOptions,
    );
    observer.firstSubscribe = false;
  }

  private unsubscribeObservers(): void {
    for (const observer of this.observers) {
      observer.unsubscribeQuery?.();
      observer.unsubscribeQuery = null;
    }
  }

  private rebindObservers(): void {
    for (const observer of this.observers) this.bindObserver(observer);
  }

  private currentCache(): AppServerQueryCache {
    if (!this.cache) throw new Error("Codex app-server resource store is not initialized.");
    return this.cache;
  }
}
