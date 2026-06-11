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

export interface SharedAppServerCacheContext {
  codexPath: string;
  vaultPath: string;
  appServerUserAgent: string | null;
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; context: SharedAppServerCacheContext; data: T };

export interface SharedAppServerState {
  threads: SharedCache<readonly Thread[]>;
  appServerMetadata: SharedCache<SharedAppServerMetadata>;
  availableModels: SharedCache<readonly ModelMetadata[]>;
}

export function createSharedAppServerState(): SharedAppServerState {
  return {
    threads: { kind: "unloaded" },
    appServerMetadata: { kind: "unloaded" },
    availableModels: { kind: "unloaded" },
  };
}

export function applySharedThreadList(
  state: SharedAppServerState,
  context: SharedAppServerCacheContext,
  threads: readonly Thread[],
): SharedAppServerState {
  return {
    ...state,
    threads: { kind: "loaded", context: cloneSharedAppServerCacheContext(context), data: cloneThreads(threads) },
  };
}

export function applySharedAppServerMetadata(
  state: SharedAppServerState,
  context: SharedAppServerCacheContext,
  metadata: SharedAppServerMetadata,
): SharedAppServerState {
  const clonedMetadata = cloneSharedAppServerMetadata(metadata);
  return {
    ...state,
    appServerMetadata: { kind: "loaded", context: cloneSharedAppServerCacheContext(context), data: clonedMetadata },
    availableModels: {
      kind: "loaded",
      context: cloneSharedAppServerCacheContext(context),
      data: cloneModelMetadata(clonedMetadata.availableModels),
    },
  };
}

export function applySharedModels(
  state: SharedAppServerState,
  context: SharedAppServerCacheContext,
  models: readonly ModelMetadata[],
): SharedAppServerState {
  const clonedModels = cloneModelMetadata(models);
  return {
    ...state,
    appServerMetadata:
      state.appServerMetadata.kind === "loaded" && sharedAppServerCacheContextMatches(state.appServerMetadata.context, context)
        ? {
            kind: "loaded",
            context: cloneSharedAppServerCacheContext(context),
            data: { ...state.appServerMetadata.data, availableModels: cloneModelMetadata(clonedModels) },
          }
        : state.appServerMetadata,
    availableModels: { kind: "loaded", context: cloneSharedAppServerCacheContext(context), data: clonedModels },
  };
}

export function cachedSharedThreadList(state: SharedAppServerState, context: SharedAppServerCacheContext): readonly Thread[] | null {
  return state.threads.kind === "loaded" && sharedAppServerCacheContextMatches(state.threads.context, context)
    ? cloneThreads(state.threads.data)
    : null;
}

export function cachedSharedAppServerMetadata(
  state: SharedAppServerState,
  context: SharedAppServerCacheContext,
): SharedAppServerMetadata | null {
  if (state.appServerMetadata.kind === "loaded" && sharedAppServerCacheContextMatches(state.appServerMetadata.context, context)) {
    return cloneSharedAppServerMetadata(state.appServerMetadata.data);
  }
  return null;
}

export function cachedSharedModels(state: SharedAppServerState, context: SharedAppServerCacheContext): ModelMetadata[] {
  return state.availableModels.kind === "loaded" && sharedAppServerCacheContextMatches(state.availableModels.context, context)
    ? cloneModelMetadata(state.availableModels.data)
    : [];
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

function cloneSharedAppServerCacheContext(context: SharedAppServerCacheContext): SharedAppServerCacheContext {
  return { ...context };
}

export function sharedAppServerCacheContextMatches(left: SharedAppServerCacheContext, right: SharedAppServerCacheContext): boolean {
  return left.codexPath === right.codexPath && left.vaultPath === right.vaultPath && left.appServerUserAgent === right.appServerUserAgent;
}
