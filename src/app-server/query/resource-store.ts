import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadata } from "../../domain/server/metadata";
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
  cache?: AppServerQueryCache;
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
  readonly observe: (
    context: AppServerQueryContextIdentity,
    listener: (value: T) => void,
    options: { emitCurrent?: boolean },
  ) => () => void;
  readonly listener: (value: T) => void;
  readonly options: { emitCurrent?: boolean };
  firstSubscribe: boolean;
  unsubscribeQuery: (() => void) | null;
}

export class AppServerResourceStore {
  private readonly observers = new Set<ResourceObserver<unknown>>();
  private readonly cache: AppServerQueryCache;
  private lease: AppServerContextLease | null = null;
  private generation = 0;

  constructor(options: AppServerResourceStoreOptions = {}) {
    this.cache = options.cache ?? new AppServerQueryCache(options.clientRunner ? { clientRunner: options.clientRunner } : {});
  }

  initialize(context: AppServerQueryContext): AppServerContextLease {
    if (this.lease) throw new Error("Codex app-server resource store is already initialized.");
    this.lease = this.nextLease(context);
    this.rebindObservers();
    return this.lease;
  }

  replaceContext(context: AppServerQueryContext): AppServerContextLease {
    if (!this.lease) throw new Error("Codex app-server resource store is not initialized.");
    if (appServerQueryContextRawEquals(this.lease.context, context)) return this.lease;
    this.unsubscribeObservers();
    this.cache.release(appServerQueryContextIdentity(this.lease));
    this.lease = this.nextLease(context);
    this.rebindObservers();
    return this.lease;
  }

  reset(): void {
    this.unsubscribeObservers();
    if (this.lease) this.cache.release(appServerQueryContextIdentity(this.lease));
    this.lease = null;
    this.cache.clear();
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
    return this.lease ? this.cache.activeThreadsSnapshot(this.contextIdentity()) : null;
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.lease ? this.cache.archivedThreadsSnapshot(this.contextIdentity()) : null;
  }

  fetchAllActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.cache.fetchAllActiveThreads(context));
  }

  hasMoreActiveThreads(): boolean {
    return this.lease ? this.cache.hasMoreActiveThreads(this.contextIdentity()) : false;
  }

  loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.cache.loadMoreActiveThreads(context));
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.cache.refreshActiveThreads(context));
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.cache.refreshArchivedThreads(context));
  }

  observeActiveThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.cache.observeActiveThreadsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.cache.observeArchivedThreadsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.lease ? this.cache.appServerMetadataSnapshot(this.contextIdentity()) : null;
  }

  refreshAppServerMetadata(): Promise<SharedServerMetadata | null> {
    return this.runForCurrentContext((context) => this.cache.refreshAppServerMetadata(context));
  }

  refreshSkills(): Promise<SharedServerMetadata | null> {
    return this.runForCurrentContext((context) => this.cache.refreshSkills(context));
  }

  refreshRateLimits(): Promise<SharedServerMetadata | null> {
    return this.runForCurrentContext((context) => this.cache.refreshRateLimits(context));
  }

  observeAppServerMetadataResult(listener: ObservedResultListener<SharedServerMetadata>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.cache.observeAppServerMetadataResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    return this.lease ? this.cache.modelsSnapshot(this.contextIdentity()) : null;
  }

  fetchModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((context) => this.cache.fetchModels(context));
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((context) => this.cache.refreshModels(context));
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.cache.observeModelsResult(context, contextListener, observeOptions),
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

  private runForCurrentContext<T>(operation: (context: AppServerQueryContextIdentity) => Promise<T>): Promise<T> {
    const context = this.contextIdentity();
    return this.runForIdentity(context, () => operation(context));
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
    if (!this.lease) return;
    const context = this.contextIdentity();
    const observeOptions: { emitCurrent?: boolean } = {};
    if (observer.firstSubscribe) {
      if (observer.options.emitCurrent !== undefined) observeOptions.emitCurrent = observer.options.emitCurrent;
    } else {
      observeOptions.emitCurrent = true;
    }
    observer.unsubscribeQuery = observer.observe(
      context,
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
}
