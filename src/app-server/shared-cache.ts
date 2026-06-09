import type { Model } from "../generated/app-server/v2/Model";
import type { PanelThread } from "../domain/threads/model";
import {
  applySharedAppServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedAppServerMetadata,
  cachedSharedModels,
  cachedSharedThreadList,
  createSharedAppServerState,
  type SharedAppServerMetadata,
  type SharedAppServerState,
} from "./shared-cache-state";

type ThreadListRefreshLifecycleState = { kind: "idle" } | { kind: "refreshing"; promise: Promise<readonly PanelThread[]> };

export class SharedAppServerCache {
  private state: SharedAppServerState = createSharedAppServerState();
  private threadListRefreshLifecycle: ThreadListRefreshLifecycleState = { kind: "idle" };

  refreshThreadList(
    fetchThreads: () => Promise<readonly PanelThread[]>,
    onSnapshot?: (threads: readonly PanelThread[]) => void,
  ): Promise<readonly PanelThread[]> {
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

  applyThreadListSnapshot(threads: readonly PanelThread[]): void {
    this.state = applySharedThreadList(this.state, threads);
  }

  cachedThreadList(): readonly PanelThread[] | null {
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
    return cachedSharedModels(this.state);
  }
}
