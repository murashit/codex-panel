import type { Thread } from "../generated/app-server/v2/Thread";
import type { Model } from "../generated/app-server/v2/Model";
import {
  applySharedAppServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedAppServerMetadata,
  cachedSharedThreadList,
  createSharedAppServerState,
  type SharedAppServerMetadata,
  type SharedAppServerState,
} from "./shared-app-server-state";

type ThreadListRefreshLifecycleState = { kind: "idle" } | { kind: "refreshing"; promise: Promise<readonly Thread[]> };

export class SharedAppServerCache {
  private state: SharedAppServerState = createSharedAppServerState();
  private threadListRefreshLifecycle: ThreadListRefreshLifecycleState = { kind: "idle" };

  refreshThreadList(
    fetchThreads: () => Promise<readonly Thread[]>,
    onSnapshot?: (threads: readonly Thread[]) => void,
  ): Promise<readonly Thread[]> {
    if (this.threadListRefreshLifecycle.kind === "refreshing") return this.threadListRefreshLifecycle.promise;
    const promise = fetchThreads()
      .then((threads) => {
        this.applyThreadListSnapshot(threads);
        onSnapshot?.(threads);
        return threads;
      })
      .finally(() => {
        if (this.threadListRefreshLifecycle.kind === "refreshing" && this.threadListRefreshLifecycle.promise === promise) {
          this.threadListRefreshLifecycle = { kind: "idle" };
        }
      });
    this.threadListRefreshLifecycle = { kind: "refreshing", promise };
    return promise;
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.state = applySharedThreadList(this.state, threads);
  }

  cachedThreadList(): readonly Thread[] | null {
    return cachedSharedThreadList(this.state);
  }

  applyAppServerMetadataSnapshot(metadata: SharedAppServerMetadata): void {
    this.state = applySharedAppServerMetadata(this.state, metadata);
  }

  cachedAppServerMetadata(): SharedAppServerMetadata | null {
    return cachedSharedAppServerMetadata(this.state);
  }

  applyModelsSnapshot(models: readonly Model[]): void {
    this.state = applySharedModels(this.state, models);
  }

  cachedModels(): Model[] {
    return [...this.state.availableModels];
  }
}
