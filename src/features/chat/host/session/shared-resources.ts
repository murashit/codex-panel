import type { SkillMetadata } from "../../../../domain/runtime/catalog";
import { createMetadataResourceDiagnostics, type MetadataResourceDiagnostics } from "../../../../domain/runtime/diagnostics";
import type { SharedServerMetadataResourceFor } from "../../../../domain/runtime/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { ToolInventorySnapshot } from "../../../../domain/runtime/tool-inventory";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatRuntimeSharedResources } from "../../application/runtime/snapshot";
import type { ChatStateStore } from "../../application/state/store";
import type { CodexChatHost } from "../contracts";

export interface SessionSharedResources extends ChatRuntimeSharedResources {
  skillsSnapshot(): readonly SkillMetadata[] | null;
  permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
  activeThreadsSnapshot(): readonly Thread[] | null;
  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
  modelsResourceSnapshot(): SharedServerMetadataResourceFor<"models">;
  subscribeModels(listener: () => void): () => void;
  dispose(): void;
  ensureModels(): Promise<void>;
  toolInventorySnapshot(threadId: string | null): ToolInventorySnapshot | null;
  ensureToolInventory(threadId: string | null): Promise<ToolInventorySnapshot>;
  subscribe(listener: () => void): () => void;
}

export function createSessionSharedResources(
  plugin: Pick<CodexChatHost, "appServerQueries" | "threadCatalog" | "toolInventoryQueries">,
  stateStore: ChatStateStore,
): SessionSharedResources {
  const queries = plugin.appServerQueries;
  const modelListeners = new Set<() => void>();
  const modelProvider = () => {
    const state = stateStore.getState();
    // A restored conversation must establish its provider before showing models.
    return state.panelThread.kind === "empty" ? undefined : state.runtime.active.modelProvider;
  };
  const modelsResourceSnapshot = (): SharedServerMetadataResourceFor<"models"> => {
    const provider = modelProvider();
    return provider === null
      ? { id: "models", value: undefined, probe: createMetadataResourceDiagnostics().probes.models }
      : queries.modelsResourceSnapshot(provider);
  };
  const notifyModels = () => {
    for (const listener of modelListeners) listener();
  };
  let provider = modelProvider();
  const observeModels = () => (provider === null ? () => undefined : queries.observeModelsResource(notifyModels, provider));
  let stopModels = observeModels();
  const stopState = stateStore.subscribe(() => {
    const next = modelProvider();
    if (next === provider) return;
    stopModels();
    provider = next;
    stopModels = observeModels();
    notifyModels();
  });
  const subscribeModels = (listener: () => void) => {
    modelListeners.add(listener);
    listener();
    return () => {
      modelListeners.delete(listener);
    };
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
    modelsResourceSnapshot,
    subscribeModels,
    dispose: () => {
      stopState();
      stopModels();
      modelListeners.clear();
    },
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
        queries.observeMetadataResource("runtimeConfig", listener),
        queries.observeMetadataResource("skills", listener),
        queries.observeMetadataResource("permissionProfiles", listener),
        queries.observeMetadataResource("rateLimits", listener),
        plugin.threadCatalog.observeActiveThreadsResult(listener),
      ];
      const stopModelChanges = subscribeModels(listener);
      return () => {
        stopModelChanges();
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}
