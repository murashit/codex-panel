import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";

export type { SharedServerMetadata } from "../../domain/server/metadata";

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

export function mergeSharedServerMetadata(previous: SharedServerMetadata | null, next: SharedServerMetadata): SharedServerMetadata {
  const clonedNext = cloneSharedServerMetadata(next);
  const clonedPrevious = previous ? cloneSharedServerMetadata(previous) : emptySharedServerMetadataResourceCache(clonedNext);
  return {
    ...clonedNext,
    availableModels: metadataResourceSucceeded(clonedNext, "model/list") ? clonedNext.availableModels : clonedPrevious.availableModels,
    availableSkills: metadataResourceSucceeded(clonedNext, "skills/list") ? clonedNext.availableSkills : clonedPrevious.availableSkills,
    rateLimit: metadataResourceSucceeded(clonedNext, "account/rateLimits/read") ? clonedNext.rateLimit : clonedPrevious.rateLimit,
    serverDiagnostics: mergeServerDiagnostics(clonedPrevious, clonedNext),
  };
}

function emptySharedServerMetadataResourceCache(metadata: SharedServerMetadata): SharedServerMetadata {
  return {
    ...metadata,
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    serverDiagnostics: {
      probes: { ...metadata.serverDiagnostics.probes },
      mcpServers: [],
    },
  };
}

function metadataResourceSucceeded(
  metadata: SharedServerMetadata,
  method: keyof SharedServerMetadata["serverDiagnostics"]["probes"],
): boolean {
  return metadata.serverDiagnostics.probes[method].status === "ok";
}

function mergeServerDiagnostics(previous: SharedServerMetadata, next: SharedServerMetadata): SharedServerMetadata["serverDiagnostics"] {
  return {
    probes: { ...next.serverDiagnostics.probes },
    mcpServers:
      next.serverDiagnostics.probes["mcpServerStatus/list"].status === "failed"
        ? previous.serverDiagnostics.mcpServers.map((server) => ({ ...server }))
        : next.serverDiagnostics.mcpServers.map((server) => ({ ...server })),
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
