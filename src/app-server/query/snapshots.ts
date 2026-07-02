import type { ModelMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import { cloneToolInventorySnapshot } from "../../domain/server/tool-inventory";
import type { Thread } from "../../domain/threads/model";

export function cloneThreads(threads: readonly Thread[]): Thread[] {
  return threads.map((thread) => ({ ...thread }));
}

export function cloneModelMetadata(models: readonly ModelMetadata[]): ModelMetadata[] {
  return models.map((model) => ({
    ...model,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    inputModalities: [...model.inputModalities],
    additionalSpeedTiers: [...model.additionalSpeedTiers],
    serviceTiers: model.serviceTiers.map((tier) => ({ ...tier })),
  }));
}

export function cloneSharedServerMetadata(metadata: SharedServerMetadata): SharedServerMetadata {
  return {
    ...metadata,
    runtimeConfig: metadata.runtimeConfig ? cloneRuntimeConfigSnapshot(metadata.runtimeConfig) : null,
    rateLimit: metadata.rateLimit ? cloneRateLimitSnapshot(metadata.rateLimit) : null,
    availableModels: cloneModelMetadata(metadata.availableModels),
    availableSkills: metadata.availableSkills.map((skill) => ({ ...skill })),
    availablePermissionProfiles: metadata.availablePermissionProfiles.map((profile) => ({ ...profile })),
    serverDiagnostics: {
      probes: { ...metadata.serverDiagnostics.probes },
      mcpServers: metadata.serverDiagnostics.mcpServers.map((server) => ({ ...server })),
      toolInventory: metadata.serverDiagnostics.toolInventory ? cloneToolInventorySnapshot(metadata.serverDiagnostics.toolInventory) : null,
    },
  };
}

function cloneRateLimitSnapshot(snapshot: RateLimitSnapshot): RateLimitSnapshot {
  return {
    ...snapshot,
    primary: snapshot.primary ? { ...snapshot.primary } : null,
    secondary: snapshot.secondary ? { ...snapshot.secondary } : null,
    individualLimit: snapshot.individualLimit ? { ...snapshot.individualLimit } : null,
  };
}
