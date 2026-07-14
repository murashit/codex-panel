import type { ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import type { AppServerQueryCache, MetadataResourceKind } from "./cache";
import {
  type AppServerQueryContext,
  appServerQueryContextKey,
  appServerQueryContextMatches,
  appServerQueryContextRawEquals,
  cloneAppServerQueryContext,
} from "./keys";
import type { ObservedResultListener } from "./observed-result";

export interface AppServerSharedQueriesOptions {
  cache: AppServerQueryCache;
  context: () => AppServerQueryContext;
}

export class StaleAppServerSharedQueryContextError extends Error {
  constructor() {
    super("Codex app-server query context changed while loading shared queries.");
    this.name = "StaleAppServerSharedQueryContextError";
  }
}

export function isStaleAppServerSharedQueryContextError(error: unknown): error is StaleAppServerSharedQueryContextError {
  return error instanceof StaleAppServerSharedQueryContextError;
}

export class AppServerSharedQueries {
  private readonly contextChangeListeners = new Set<() => void>();

  constructor(private readonly options: AppServerSharedQueriesOptions) {}

  contextKey(): string {
    return appServerQueryContextKey(this.context());
  }

  contextKeyFor(context: AppServerQueryContext): string {
    return appServerQueryContextKey(context);
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    return this.options.cache.activeThreadsSnapshot(this.context());
  }

  activeThreadsSnapshotFor(context: AppServerQueryContext): readonly Thread[] | null {
    return this.options.cache.activeThreadsSnapshot(context);
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    return this.options.cache.archivedThreadsSnapshot(this.context());
  }

  archivedThreadsSnapshotFor(context: AppServerQueryContext): readonly Thread[] | null {
    return this.options.cache.archivedThreadsSnapshot(context);
  }

  fetchAllActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.options.cache.fetchAllActiveThreads(context));
  }

  hasMoreActiveThreads(): boolean {
    return this.options.cache.hasMoreActiveThreads(this.context());
  }

  loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.options.cache.loadMoreActiveThreads(context));
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.options.cache.refreshActiveThreads(context));
  }

  refreshActiveThreadsFor(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.options.cache.refreshActiveThreads(context);
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.runForCurrentContext((context) => this.options.cache.refreshArchivedThreads(context));
  }

  refreshArchivedThreadsFor(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.options.cache.refreshArchivedThreads(context);
  }

  observeActiveThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) => this.options.cache.observeActiveThreadsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void {
    return this.observeCurrentContext(
      (context, contextListener, observeOptions) =>
        this.options.cache.observeArchivedThreadsResult(context, contextListener, observeOptions),
      listener,
      options,
    );
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    return this.options.cache.appServerMetadataSnapshot(this.context());
  }

  updateAppServerMetadata(
    updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null,
    resource?: MetadataResourceKind,
  ): SharedServerMetadata | null {
    return this.options.cache.updateAppServerMetadata(this.context(), updater, resource);
  }

  beginAppServerMetadataResourceRefresh(resource: MetadataResourceKind): () => boolean {
    const context = this.context();
    const revision = this.options.cache.beginMetadataResourceRefresh(context, resource);
    return () =>
      appServerQueryContextMatches(this.context(), context) &&
      this.options.cache.metadataResourceRefreshIsCurrent(context, resource, revision);
  }

  refreshAppServerMetadata(options: { forceSkills?: boolean } = {}): Promise<SharedServerMetadata | null> {
    return this.runForCurrentContext((context) => this.options.cache.refreshAppServerMetadata(context, options));
  }

  observeAppServerMetadataResult(listener: ObservedResultListener<SharedServerMetadata>, options?: { emitCurrent?: boolean }): () => void {
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
    return this.runForCurrentContext((context) => this.options.cache.fetchModels(context));
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.runForCurrentContext((context) => this.options.cache.refreshModels(context));
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void {
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

  private async runForCurrentContext<T>(operation: (context: AppServerQueryContext) => Promise<T>): Promise<T> {
    const context = cloneAppServerQueryContext(this.context());
    const result = await operation(context);
    if (!appServerQueryContextRawEquals(this.context(), context)) {
      throw new StaleAppServerSharedQueryContextError();
    }
    return result;
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
