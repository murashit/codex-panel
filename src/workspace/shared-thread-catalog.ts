import type { ModelMetadata } from "../domain/catalog/metadata";
import type { SharedServerMetadata } from "../domain/server/metadata";
import type { Thread } from "../domain/threads/model";
import type { AppServerQueryCache } from "../app-server/query/cache";
import { appServerQueryContextMatches, cloneAppServerQueryContext, type AppServerQueryContext } from "../app-server/query/keys";
import type { ThreadSurfaceActions } from "./thread-surface-actions";

export interface SharedThreadCatalogOptions {
  cache: AppServerQueryCache;
  surfaces: ThreadSurfaceActions;
  context: () => AppServerQueryContext;
}

export class SharedThreadCatalog {
  private readonly contextChangeListeners = new Set<() => void>();

  constructor(private readonly options: SharedThreadCatalogOptions) {}

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.options.cache.activeThreadsSnapshot(this.context());
  }

  async fetchActiveThreads(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    return this.options.cache.fetchActiveThreads(this.context(), fetchThreads);
  }

  setActiveThreads(threads: readonly Thread[]): void {
    this.options.cache.setActiveThreads(this.context(), threads);
  }

  observeActiveThreads(listener: (threads: readonly Thread[]) => void, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeActiveThreads(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.options.cache.appServerMetadataSnapshot(this.context());
  }

  setAppServerMetadata(metadata: SharedServerMetadata): void {
    this.options.cache.setAppServerMetadata(this.context(), metadata);
  }

  observeAppServerMetadata(listener: (metadata: SharedServerMetadata) => void, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeAppServerMetadata(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    return this.options.cache.modelsSnapshot(this.context());
  }

  setModels(models: readonly ModelMetadata[]): void {
    this.options.cache.setModels(this.context(), models);
  }

  observeModels(listener: (models: readonly ModelMetadata[]) => void, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeModels(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  notifyAppServerQueryContextChanged(): void {
    for (const listener of [...this.contextChangeListeners]) {
      listener();
    }
  }

  refreshFromOpenSurface(): void {
    this.invalidateThreadsFromOpenSurface();
  }

  invalidateThreadsFromOpenSurface(): void {
    this.options.surfaces.invalidateThreadsFromOpenSurface();
  }

  renameThreadInCatalog(threadId: string, name: string | null): void {
    this.options.cache.updateActiveThreads(this.context(), (current) => {
      return current ? current.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)) : null;
    });
    this.options.surfaces.applyThreadRenamed(threadId, name);
  }

  archiveThreadInCatalog(threadId: string, options?: { closeOpenPanels?: boolean }): void {
    this.options.cache.updateActiveThreads(this.context(), (current) => {
      return current ? current.filter((thread) => thread.id !== threadId) : null;
    });
    this.options.surfaces.applyThreadArchived(threadId, options);
  }

  refreshThreadsViewLiveState(): void {
    this.options.surfaces.refreshThreadsViewLiveState();
  }

  private context(): AppServerQueryContext {
    return this.options.context();
  }

  private observeCurrentContext<T>(
    observe: (context: AppServerQueryContext, listener: (value: T) => void, options: { emitCurrent?: boolean }) => () => void,
    listener: (value: T) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    let observedContext: AppServerQueryContext | null = null;
    let unsubscribeQuery: (() => void) | null = null;
    let firstSubscribe = true;

    const subscribe = (): void => {
      const context = cloneAppServerQueryContext(this.context());
      if (observedContext && appServerQueryContextMatches(observedContext, context)) return;
      unsubscribeQuery?.();
      observedContext = context;
      const observeOptions: { emitCurrent?: boolean } = {};
      if (firstSubscribe) {
        if (options.emitCurrent !== undefined) observeOptions.emitCurrent = options.emitCurrent;
      } else {
        observeOptions.emitCurrent = true;
      }
      unsubscribeQuery = observe(
        context,
        (value) => {
          if (appServerQueryContextMatches(this.context(), context)) listener(value);
        },
        observeOptions,
      );
      firstSubscribe = false;
    };

    subscribe();
    this.contextChangeListeners.add(subscribe);
    return () => {
      this.contextChangeListeners.delete(subscribe);
      unsubscribeQuery?.();
    };
  }
}
