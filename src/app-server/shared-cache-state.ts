import type { Diagnostics } from "./diagnostics";
import type { RateLimitSnapshot } from "./runtime-metrics";
import { cloneRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "./runtime-config";
import type { Thread } from "../domain/threads/model";
import type { ModelMetadata, SkillMetadata } from "../domain/catalog/metadata";

export interface SharedAppServerMetadata {
  runtimeConfig: RuntimeConfigSnapshot | null;
  availableModels: readonly ModelMetadata[];
  availableSkills: readonly SkillMetadata[];
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: Diagnostics;
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; data: T };

export interface SharedAppServerState {
  threads: SharedCache<readonly Thread[]>;
  appServerMetadata: SharedCache<SharedAppServerMetadata>;
  availableModels: readonly ModelMetadata[];
}

export function createSharedAppServerState(): SharedAppServerState {
  return {
    threads: { kind: "unloaded" },
    appServerMetadata: { kind: "unloaded" },
    availableModels: [],
  };
}

export function applySharedThreadList(state: SharedAppServerState, threads: readonly Thread[]): SharedAppServerState {
  return {
    ...state,
    threads: { kind: "loaded", data: cloneThreads(threads) },
  };
}

export function applySharedAppServerMetadata(state: SharedAppServerState, metadata: SharedAppServerMetadata): SharedAppServerState {
  const clonedMetadata = cloneSharedAppServerMetadata(metadata);
  return {
    ...state,
    appServerMetadata: { kind: "loaded", data: clonedMetadata },
    availableModels: cloneModelMetadata(clonedMetadata.availableModels),
  };
}

export function applySharedModels(state: SharedAppServerState, models: readonly ModelMetadata[]): SharedAppServerState {
  const clonedModels = cloneModelMetadata(models);
  return {
    ...state,
    appServerMetadata:
      state.appServerMetadata.kind === "loaded"
        ? { kind: "loaded", data: { ...state.appServerMetadata.data, availableModels: cloneModelMetadata(clonedModels) } }
        : state.appServerMetadata,
    availableModels: clonedModels,
  };
}

export function cachedSharedThreadList(state: SharedAppServerState): readonly Thread[] | null {
  return state.threads.kind === "loaded" ? cloneThreads(state.threads.data) : null;
}

export function cachedSharedAppServerMetadata(state: SharedAppServerState): SharedAppServerMetadata | null {
  if (state.appServerMetadata.kind === "loaded") return cloneSharedAppServerMetadata(state.appServerMetadata.data);
  return null;
}

export function cachedSharedModels(state: SharedAppServerState): ModelMetadata[] {
  return cloneModelMetadata(state.availableModels);
}

function cloneSharedAppServerMetadata(metadata: SharedAppServerMetadata): SharedAppServerMetadata {
  return {
    ...metadata,
    runtimeConfig: metadata.runtimeConfig ? cloneRuntimeConfigSnapshot(metadata.runtimeConfig) : null,
    availableModels: cloneModelMetadata(metadata.availableModels),
    availableSkills: cloneSkillMetadata(metadata.availableSkills),
    appServerDiagnostics: {
      probes: { ...metadata.appServerDiagnostics.probes },
      mcpServers: metadata.appServerDiagnostics.mcpServers.map((server) => ({ ...server })),
    },
  };
}

function cloneThreads(threads: readonly Thread[]): Thread[] {
  return threads.map((thread) => ({ ...thread }));
}

function cloneModelMetadata(models: readonly ModelMetadata[]): ModelMetadata[] {
  return models.map((model) => ({
    ...model,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    inputModalities: [...model.inputModalities],
    additionalSpeedTiers: [...model.additionalSpeedTiers],
    serviceTiers: model.serviceTiers.map((tier) => ({ ...tier })),
  }));
}

function cloneSkillMetadata(skills: readonly SkillMetadata[]): SkillMetadata[] {
  return skills.map((skill) => ({ ...skill }));
}
