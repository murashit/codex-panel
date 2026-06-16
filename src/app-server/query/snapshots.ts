import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
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
    availableSkills: cloneSkillMetadata(metadata.availableSkills),
    serverDiagnostics: {
      probes: { ...metadata.serverDiagnostics.probes },
      mcpServers: metadata.serverDiagnostics.mcpServers.map((server) => ({ ...server })),
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

function cloneSkillMetadata(skills: readonly SkillMetadata[]): SkillMetadata[] {
  return skills.map((skill) => ({ ...skill }));
}
