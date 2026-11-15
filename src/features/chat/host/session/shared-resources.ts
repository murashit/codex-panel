import type { SkillMetadata } from "../../../../domain/runtime/catalog";
import type { MetadataResourceDiagnostics } from "../../../../domain/runtime/diagnostics";
import type { SharedServerMetadataResourceFor, SharedServerMetadataResourceId } from "../../../../domain/runtime/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { ToolInventorySnapshot } from "../../../../domain/runtime/tool-inventory";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import type { ChatStateStore } from "../../application/state/store";
import type { ChatMetadataSource, CodexChatHost } from "../contracts";

export interface SessionSharedResources extends ChatRuntimeSharedResources, ChatMetadataSource {
  skillsSnapshot(): readonly SkillMetadata[] | null;
  permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
  activeThreadsSnapshot(): readonly Thread[] | null;
  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
  ensureModels(): Promise<void>;
  toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
  ensureToolInventory(threadId: string | null): Promise<ToolInventorySnapshot>;
  subscribe(listener: () => void): () => void;
}

type MetadataObservers = {
  [Id in SharedServerMetadataResourceId]: (listener: (resource: SharedServerMetadataResourceFor<Id>) => void) => () => void;
};

export function createSessionSharedResources(
  plugin: Pick<CodexChatHost, "appServerQueries" | "threadCatalog" | "toolInventoryQueries">,
  stateStore: ChatStateStore,
): SessionSharedResources {
  const queries = plugin.appServerQueries;
  const modelProvider = () => stateStore.getState().runtime.active.modelProvider ?? undefined;
  const modelsResourceSnapshot = () => queries.modelsResourceSnapshot(modelProvider());
  const metadataObservers: MetadataObservers = {
    models: (listener) => queries.observeModelsResource(listener, modelProvider, (changed) => stateStore.subscribe(changed)),
    runtimeConfig: (listener) => queries.observeMetadataResource("runtimeConfig", listener),
    skills: (listener) => queries.observeMetadataResource("skills", listener),
    permissionProfiles: (listener) => queries.observeMetadataResource("permissionProfiles", listener),
    rateLimits: (listener) => queries.observeMetadataResource("rateLimits", listener),
  };
  return {
    ensureModels: async () => {
      const provider = modelProvider();
      // Common metadata already loads the default catalog, including optional failures.
      if (typeof provider === "string")
        await queries.fetchModels(provider).catch(() => {
          // Catalog failures are reported by the resource probe, not as connection failures.
        });
    },
    observeMetadataResource: (id, listener) => metadataObservers[id](listener),
    runtimeConfigSnapshot: () => queries.metadataSnapshot("runtimeConfig"),
    rateLimitsSnapshot: () => queries.metadataSnapshot("rateLimits"),
    modelsSnapshot: () => modelsResourceSnapshot().value ?? null,
    skillsSnapshot: () => queries.metadataSnapshot("skills"),
    permissionProfilesSnapshot: () => queries.metadataSnapshot("permissionProfiles"),
    activeThreadsSnapshot: () => plugin.threadCatalog.activeThreadsSnapshot(),
    metadataDiagnosticsSnapshot: () => ({
      probes: { ...queries.metadataDiagnosticsSnapshot().probes, models: modelsResourceSnapshot().probe },
    }),
    toolInventorySnapshot: (threadId) => plugin.toolInventoryQueries.snapshot(threadId),
    ensureToolInventory: (threadId) => plugin.toolInventoryQueries.ensure(threadId),
    subscribe: (listener) => {
      const unsubscribers = [
        metadataObservers.runtimeConfig(listener),
        metadataObservers.skills(listener),
        metadataObservers.permissionProfiles(listener),
        metadataObservers.rateLimits(listener),
        plugin.threadCatalog.observeActiveThreadsResult(listener),
      ];
      const stopModelChanges = metadataObservers.models(listener);
      return () => {
        stopModelChanges();
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}
