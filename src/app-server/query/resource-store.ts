import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import { AppServerQueryCache, type AppServerQueryClientRunner } from "./cache";
import type { AppServerQueryContext } from "./keys";
import type { ObservedPaginatedResultListener, ObservedResultListener } from "./observed-result";
import type { ThreadListMutation } from "./thread-list-mutation";

export interface AppServerResourceStoreOptions {
  context: AppServerQueryContext;
  clientRunner: AppServerQueryClientRunner;
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

export class AppServerResourceStore {
  private readonly cache: AppServerQueryCache;
  private readonly observerUnsubscribes = new Set<() => void>();
  private disposed = false;

  constructor(options: AppServerResourceStoreOptions) {
    const context = Object.freeze({ ...options.context });
    this.cache = new AppServerQueryCache(context, { clientRunner: options.clientRunner });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.observerUnsubscribes) unsubscribe();
    this.observerUnsubscribes.clear();
    this.cache.dispose();
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.cache.activeThreadsSnapshot();
  }

  recentActiveThreadsSnapshot(): readonly Thread[] | null {
    return this.cache.recentActiveThreadsSnapshot();
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.cache.archivedThreadsSnapshot();
  }

  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((cache) => cache.fetchActiveThreadSearchInventory());
  }

  hasMoreActiveThreads(): boolean {
    return this.cache.hasMoreActiveThreads();
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
    this.assertActive();
    this.cache.applyThreadListMutations(mutations);
  }

  observeActiveThreadsResult(
    listener: ObservedPaginatedResultListener<readonly Thread[]>,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observe((contextListener) => this.cache.observeActiveThreadsResult(contextListener, options), listener);
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observe((contextListener) => this.cache.observeArchivedThreadsResult(contextListener, options), listener);
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.cache.appServerMetadataSnapshot();
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
    return this.observe((contextListener) => this.cache.observeAppServerMetadataResources(contextListener, options), listener);
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    return this.cache.modelsSnapshot();
  }

  fetchModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((cache) => cache.fetchModels());
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((cache) => cache.refreshModels());
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observe((contextListener) => this.cache.observeModelsResult(contextListener, options), listener);
  }

  private runForCurrentContext<T>(operation: (cache: AppServerQueryCache) => Promise<T>): Promise<T> {
    this.assertActive();
    return this.runWhileActive(() => operation(this.cache));
  }

  private async runWhileActive<T>(operation: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (this.disposed) throw new StaleAppServerResourceContextError();
      throw error;
    }
    if (this.disposed) throw new StaleAppServerResourceContextError();
    return result;
  }

  private observe<T>(subscribe: (listener: (value: T) => void) => () => void, listener: (value: T) => void): () => void {
    this.assertActive();
    const unsubscribe = subscribe((value) => {
      if (!this.disposed) listener(value);
    });
    this.observerUnsubscribes.add(unsubscribe);
    return () => {
      if (!this.observerUnsubscribes.delete(unsubscribe)) return;
      unsubscribe();
    };
  }

  private assertActive(): void {
    if (this.disposed) throw new StaleAppServerResourceContextError();
  }
}
