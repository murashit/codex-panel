import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import type { AppServerObservedQueryResult, AppServerQueryCache } from "./cache";
import { appServerQueryContextMatches, cloneAppServerQueryContext, type AppServerQueryContext } from "./keys";
import type { SharedServerMetadata } from "./snapshots";

export interface AppServerSharedQueriesOptions {
  cache: AppServerQueryCache;
  context: () => AppServerQueryContext;
}

export class AppServerSharedQueries {
  private readonly contextChangeListeners = new Set<() => void>();

  constructor(private readonly options: AppServerSharedQueriesOptions) {}

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.options.cache.activeThreadsSnapshot(this.context());
  }

  fetchActiveThreads(): Promise<readonly Thread[]> {
    return this.options.cache.fetchActiveThreads(this.context());
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.options.cache.refreshActiveThreads(this.context());
  }

  setActiveThreads(threads: readonly Thread[]): void {
    this.options.cache.setActiveThreads(this.context(), threads);
  }

  updateActiveThreads(updater: (threads: readonly Thread[] | null) => readonly Thread[] | null): readonly Thread[] | null {
    return this.options.cache.updateActiveThreads(this.context(), updater);
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

  fetchAppServerMetadata(): Promise<SharedServerMetadata | null> {
    return this.options.cache.fetchAppServerMetadata(this.context());
  }

  refreshAppServerMetadata(options: { forceSkills?: boolean } = {}): Promise<SharedServerMetadata | null> {
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

  fetchModels(): Promise<readonly ModelMetadata[]> {
    return this.options.cache.fetchModels(this.context());
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
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

  notifyContextChanged(): void {
    for (const listener of [...this.contextChangeListeners]) {
      listener();
    }
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
