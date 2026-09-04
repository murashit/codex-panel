import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import type { ChatPanelEnvironment } from "../contracts";

export interface SessionSharedResources extends ChatRuntimeSharedResources {
  skillsSnapshot(): readonly SkillMetadata[] | null;
  permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
  activeThreadsSnapshot(): readonly Thread[] | null;
  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
  toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
  ensureToolInventory(threadId: string | null): Promise<ToolInventorySnapshot>;
  subscribe(listener: () => void): () => void;
}

export function createSessionSharedResources(environment: ChatPanelEnvironment): SessionSharedResources {
  const queries = environment.plugin.appServerQueries;
  return {
    runtimeConfigSnapshot: () => queries.metadataSnapshot("runtimeConfig"),
    rateLimitsSnapshot: () => queries.metadataSnapshot("rateLimits"),
    modelsSnapshot: () => queries.metadataSnapshot("models"),
    skillsSnapshot: () => queries.metadataSnapshot("skills"),
    permissionProfilesSnapshot: () => queries.metadataSnapshot("permissionProfiles"),
    activeThreadsSnapshot: () => environment.plugin.threadCatalog.activeThreadsSnapshot(),
    metadataDiagnosticsSnapshot: () => queries.metadataDiagnosticsSnapshot(),
    toolInventorySnapshot: (threadId) => environment.plugin.toolInventoryQueries.snapshot(threadId),
    ensureToolInventory: (threadId) => environment.plugin.toolInventoryQueries.ensure(threadId),
    subscribe: (listener) => {
      const unsubscribers = [
        queries.observeMetadataResource("runtimeConfig", listener),
        queries.observeMetadataResource("models", listener),
        queries.observeMetadataResource("skills", listener),
        queries.observeMetadataResource("permissionProfiles", listener),
        queries.observeMetadataResource("rateLimits", listener),
        environment.plugin.threadCatalog.observeActiveThreadsResult(listener),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}
