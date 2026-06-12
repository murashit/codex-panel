import type { Thread } from "../../domain/threads/model";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import {
  applySharedServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedServerMetadata,
  cachedSharedModels,
  cachedSharedThreadList,
  createSharedAppServerState,
  sharedAppServerCacheContextIsComplete,
  sharedAppServerCacheContextMatches,
  type SharedAppServerCacheContext,
  type SharedServerMetadata,
  type SharedAppServerState,
} from "./shared-cache-state";

type ThreadListRefreshLifecycleState =
  | { kind: "idle" }
  | { kind: "refreshing"; context: SharedAppServerCacheContext; promise: Promise<readonly Thread[]> };

export class SharedAppServerCache {
  private state: SharedAppServerState = createSharedAppServerState();
  private threadListRefreshLifecycle: ThreadListRefreshLifecycleState = { kind: "idle" };

  refreshThreadList(
    context: SharedAppServerCacheContext,
    fetchThreads: () => Promise<readonly Thread[]>,
    onSnapshot?: (threads: readonly Thread[]) => void,
  ): Promise<readonly Thread[]> {
    const refreshContext = { ...context };
    if (!sharedAppServerCacheContextIsComplete(refreshContext)) {
      return fetchThreads();
    }
    if (
      this.threadListRefreshLifecycle.kind === "refreshing" &&
      sharedAppServerCacheContextMatches(this.threadListRefreshLifecycle.context, refreshContext)
    ) {
      return this.threadListRefreshLifecycle.promise;
    }
    const promise = fetchThreads()
      .then((threads) => {
        if (
          this.threadListRefreshLifecycle.kind === "refreshing" &&
          this.threadListRefreshLifecycle.promise === promise &&
          sharedAppServerCacheContextMatches(this.threadListRefreshLifecycle.context, refreshContext)
        ) {
          this.applyThreadListSnapshot(refreshContext, threads);
          onSnapshot?.(threads);
        }
        return threads;
      })
      .finally(() => {
        if (this.threadListRefreshLifecycle.kind === "refreshing" && this.threadListRefreshLifecycle.promise === promise) {
          this.threadListRefreshLifecycle = { kind: "idle" };
        }
      });
    this.threadListRefreshLifecycle = { kind: "refreshing", context: refreshContext, promise };
    return promise;
  }

  applyThreadListSnapshot(context: SharedAppServerCacheContext, threads: readonly Thread[]): void {
    this.state = applySharedThreadList(this.state, context, threads);
  }

  cachedThreadList(context: SharedAppServerCacheContext): readonly Thread[] | null {
    return cachedSharedThreadList(this.state, context);
  }

  applyAppServerMetadataSnapshot(context: SharedAppServerCacheContext, metadata: SharedServerMetadata): void {
    if (!isCacheableSharedServerMetadata(metadata)) return;
    this.state = applySharedServerMetadata(this.state, context, metadata);
  }

  cachedAppServerMetadata(context: SharedAppServerCacheContext): SharedServerMetadata | null {
    return cachedSharedServerMetadata(this.state, context);
  }

  applyModelsSnapshot(context: SharedAppServerCacheContext, models: readonly ModelMetadata[]): void {
    if (models.length === 0) return;
    this.state = applySharedModels(this.state, context, models);
  }

  cachedModels(context: SharedAppServerCacheContext): ModelMetadata[] | null {
    return cachedSharedModels(this.state, context);
  }
}

function isCacheableSharedServerMetadata(metadata: SharedServerMetadata): boolean {
  return (
    metadata.availableModels.length > 0 &&
    metadata.serverDiagnostics.probes["model/list"].status === "ok" &&
    metadata.serverDiagnostics.probes["skills/list"].status === "ok" &&
    metadata.serverDiagnostics.probes["account/rateLimits/read"].status === "ok"
  );
}
