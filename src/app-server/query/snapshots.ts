import type { ModelMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { SharedServerMetadataResource } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";

export function cloneThreads(threads: readonly Thread[]): Thread[] {
  return threads.map((thread) => ({ ...thread }));
}

export function cloneModelMetadata(models: readonly ModelMetadata[]): ModelMetadata[] {
  return models.map((model) => ({
    ...model,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => ({ ...option })),
    inputModalities: [...model.inputModalities],
    serviceTiers: model.serviceTiers.map((tier) => ({ ...tier })),
  }));
}

export function cloneSharedServerMetadataResource(resource: SharedServerMetadataResource): SharedServerMetadataResource {
  switch (resource.id) {
    case "runtimeConfig":
      return {
        id: resource.id,
        value: resource.value ? cloneRuntimeConfigSnapshot(resource.value) : undefined,
      };
    case "models":
      return {
        id: resource.id,
        value: resource.value ? cloneModelMetadata(resource.value) : undefined,
        probe: { ...resource.probe },
      };
    case "skills":
      return {
        id: resource.id,
        value: resource.value?.map((skill) => ({ ...skill })),
        probe: { ...resource.probe },
      };
    case "permissionProfiles":
      return {
        id: resource.id,
        value: resource.value?.map((profile) => ({ ...profile })),
        probe: { ...resource.probe },
      };
    case "rateLimits":
      return {
        id: resource.id,
        value: resource.value ? cloneRateLimitSnapshot(resource.value) : resource.value,
        probe: { ...resource.probe },
      };
  }
}

export function cloneRateLimitSnapshot(snapshot: RateLimitSnapshot): RateLimitSnapshot {
  return {
    ...snapshot,
    primary: snapshot.primary ? { ...snapshot.primary } : null,
    secondary: snapshot.secondary ? { ...snapshot.secondary } : null,
    individualLimit: snapshot.individualLimit ? { ...snapshot.individualLimit } : null,
  };
}
