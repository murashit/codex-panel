import type { ModelMetadata } from "../domain/catalog/metadata";
import type { SharedServerMetadata } from "../domain/server/metadata";
import type { Thread } from "../domain/threads/model";
import type { AppServerObservedQueryResult, AppServerQueryCache } from "../app-server/query/cache";
import { appServerQueryContextMatches, cloneAppServerQueryContext, type AppServerQueryContext } from "../app-server/query/keys";

interface ThreadSurfaceActions {
  invalidateThreadsFromOpenSurface(): void;
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
}

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

  async fetchActiveThreads(): Promise<readonly Thread[]> {
    return this.options.cache.fetchActiveThreads(this.context());
  }

  async refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.options.cache.refreshActiveThreads(this.context());
  }

  setActiveThreads(threads: readonly Thread[]): void {
    this.options.cache.setActiveThreads(this.context(), threads);
  }

  observeActiveThreadsResult(
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeActiveThreadsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.options.cache.appServerMetadataSnapshot(this.context());
  }

  updateAppServerMetadata(updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null): SharedServerMetadata | null {
    return this.options.cache.updateAppServerMetadata(this.context(), updater);
  }

  async fetchAppServerMetadata(): Promise<SharedServerMetadata | null> {
    return this.options.cache.fetchAppServerMetadata(this.context());
  }

  async refreshAppServerMetadata(options: { forceSkills?: boolean } = {}): Promise<SharedServerMetadata | null> {
    return this.options.cache.refreshAppServerMetadata(this.context(), options);
  }

  observeAppServerMetadataResult(
    listener: (result: AppServerObservedQueryResult<SharedServerMetadata>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) =>
        this.options.cache.observeAppServerMetadataResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    return this.options.cache.modelsSnapshot(this.context());
  }

  async fetchModels(): Promise<readonly ModelMetadata[]> {
    return this.options.cache.fetchModels(this.context());
  }

  async refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.options.cache.refreshModels(this.context());
  }

  observeModelsResult(
    listener: (result: AppServerObservedQueryResult<readonly ModelMetadata[]>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeModelsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  notifyAppServerQueryContextChanged(): void {
    for (const listener of [...this.contextChangeListeners]) {
      listener();
    }
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
