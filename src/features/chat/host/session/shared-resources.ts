import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import type { ChatPanelEnvironment } from "../contracts";

export interface SessionSharedResources extends ChatRuntimeSharedResources {
  skillsSnapshot(): readonly SkillMetadata[] | null;
  permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
  activeThreadsSnapshot(): readonly Thread[] | null;
  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
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
    subscribe: (listener) => {
      const unsubscribers = [
        queries.observeMetadataResource("runtimeConfig", listener),
        queries.observeMetadataResource("models", listener),
        queries.observeMetadataResource("skills", listener),
        queries.observeMetadataResource("permissionProfiles", listener),
        environment.plugin.threadCatalog.observeActiveThreadsResult(listener),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}
