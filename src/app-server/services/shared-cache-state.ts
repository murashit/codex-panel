import type { SharedServerMetadata } from "../../domain/server/metadata";
import { cloneRuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { Thread } from "../../domain/threads/model";
import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
export type { SharedServerMetadata } from "../../domain/server/metadata";

export interface SharedAppServerCacheContext {
  codexPath: string;
  vaultPath: string;
  appServerUserAgent: string | null;
}

type SharedThreadListSnapshotStatus = "ready" | "stale" | "unavailable";

interface SharedThreadListSnapshot {
  status: SharedThreadListSnapshotStatus;
  threads: readonly Thread[];
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; context: SharedAppServerCacheContext; data: T };

export interface SharedAppServerState {
  threads: SharedCache<SharedThreadListSnapshot>;
  appServerMetadata: SharedCache<SharedServerMetadata>;
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
  if (!sharedAppServerCacheContextIsComplete(context)) return state;
  return {
    ...state,
    threads: {
      kind: "loaded",
      context: cloneSharedAppServerCacheContext(context),
      data: cloneSharedThreadListSnapshot({ status: "ready", threads }),
    },
  };
}

export function applySharedServerMetadata(
  state: SharedAppServerState,
  context: SharedAppServerCacheContext,
  metadata: SharedServerMetadata,
): SharedAppServerState {
  if (!sharedAppServerCacheContextIsComplete(context)) return state;
  const clonedMetadata = cloneSharedServerMetadata(metadata);
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
  if (!sharedAppServerCacheContextIsComplete(context)) return state;
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
  if (!sharedAppServerCacheContextIsComplete(context)) return null;
  if (state.threads.kind !== "loaded" || !sharedAppServerCacheContextMatches(state.threads.context, context)) return null;
  if (state.threads.data.status !== "ready") return null;
  return cloneThreads(state.threads.data.threads);
}

export function cachedSharedServerMetadata(state: SharedAppServerState, context: SharedAppServerCacheContext): SharedServerMetadata | null {
  if (!sharedAppServerCacheContextIsComplete(context)) return null;
  if (state.appServerMetadata.kind === "loaded" && sharedAppServerCacheContextMatches(state.appServerMetadata.context, context)) {
    return cloneSharedServerMetadata(state.appServerMetadata.data);
  }
  return null;
}

export function cachedSharedModels(state: SharedAppServerState, context: SharedAppServerCacheContext): ModelMetadata[] | null {
  if (!sharedAppServerCacheContextIsComplete(context)) return null;
  return state.availableModels.kind === "loaded" && sharedAppServerCacheContextMatches(state.availableModels.context, context)
    ? cloneModelMetadata(state.availableModels.data)
    : null;
}

function cloneSharedServerMetadata(metadata: SharedServerMetadata): SharedServerMetadata {
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

function cloneSharedThreadListSnapshot(snapshot: SharedThreadListSnapshot): SharedThreadListSnapshot {
  return { status: snapshot.status, threads: cloneThreads(snapshot.threads) };
}

function cloneRateLimitSnapshot(snapshot: RateLimitSnapshot): RateLimitSnapshot {
  return {
    ...snapshot,
    primary: snapshot.primary ? { ...snapshot.primary } : null,
    secondary: snapshot.secondary ? { ...snapshot.secondary } : null,
    individualLimit: snapshot.individualLimit ? { ...snapshot.individualLimit } : null,
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
  return (
    sharedAppServerCacheContextIsComplete(left) &&
    sharedAppServerCacheContextIsComplete(right) &&
    left.codexPath === right.codexPath &&
    left.vaultPath === right.vaultPath &&
    left.appServerUserAgent === right.appServerUserAgent
  );
}

export function sharedAppServerCacheContextIsComplete(context: SharedAppServerCacheContext): boolean {
  return (
    nonEmptyString(context.codexPath) &&
    nonEmptyString(context.vaultPath) &&
    context.appServerUserAgent !== null &&
    nonEmptyString(context.appServerUserAgent)
  );
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
