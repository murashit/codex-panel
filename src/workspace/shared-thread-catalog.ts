import type { ModelMetadata } from "../domain/catalog/metadata";
import type { SharedServerMetadata } from "../domain/server/metadata";
import type { Thread } from "../domain/threads/model";
import type { SharedAppServerCache } from "../app-server/services/shared-cache";
import type { SharedAppServerCacheContext } from "../app-server/services/shared-cache-state";
import type { ThreadSurfaceActions } from "./thread-surface-actions";

export interface SharedThreadCatalogOptions {
  cache: SharedAppServerCache;
  surfaces: ThreadSurfaceActions;
  context: () => SharedAppServerCacheContext;
}

export class SharedThreadCatalog {
  constructor(private readonly options: SharedThreadCatalogOptions) {}

  cachedThreads(): readonly Thread[] | null {
    return this.options.cache.cachedThreadList(this.context());
  }

  async refreshThreads(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    return this.options.cache.refreshThreadList(this.context(), fetchThreads, (threads) => {
      this.options.surfaces.applyThreadListSnapshot(threads);
    });
  }

  applyThreads(threads: readonly Thread[]): void {
    this.options.cache.applyThreadListSnapshot(this.context(), threads);
    this.options.surfaces.applyThreadListSnapshot(threads);
  }

  cachedAppServerMetadata(): SharedServerMetadata | null {
    return this.options.cache.cachedAppServerMetadata(this.context());
  }

  publishAppServerMetadata(metadata: SharedServerMetadata): void {
    this.options.cache.applyAppServerMetadataSnapshot(this.context(), metadata);
    this.options.surfaces.publishAppServerMetadata(metadata);
  }

  cachedModels(): readonly ModelMetadata[] | null {
    return this.options.cache.cachedModels(this.context());
  }

  publishModels(models: readonly ModelMetadata[]): void {
    this.options.cache.applyModelsSnapshot(this.context(), models);
    this.options.surfaces.publishModels(models);
  }

  refreshFromOpenSurface(): void {
    this.options.surfaces.refreshSharedThreadListFromOpenSurface();
  }

  refreshThreadsViewLiveState(): void {
    this.options.surfaces.refreshThreadsViewLiveState();
  }

  notifyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void {
    this.options.surfaces.notifyThreadArchived(threadId, options);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.options.surfaces.notifyThreadRenamed(threadId, name);
  }

  private context(): SharedAppServerCacheContext {
    return this.options.context();
  }
}
