import type { AppServerDiagnostics } from "../app-server/compatibility";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../generated/app-server/v2/Thread";

export interface SharedAppServerMetadata {
  effectiveConfig: ConfigReadResponse | null;
  availableModels: readonly Model[];
  availableSkills: readonly SkillMetadata[];
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: AppServerDiagnostics;
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; data: T };

export interface SharedAppServerState {
  threads: SharedCache<readonly Thread[]>;
  appServerMetadata: SharedCache<SharedAppServerMetadata>;
  availableModels: readonly Model[];
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
    threads: { kind: "loaded", data: threads },
  };
}

export function applySharedAppServerMetadata(state: SharedAppServerState, metadata: SharedAppServerMetadata): SharedAppServerState {
  return {
    ...state,
    appServerMetadata: { kind: "loaded", data: metadata },
    availableModels: metadata.availableModels,
  };
}

export function applySharedModels(state: SharedAppServerState, models: readonly Model[]): SharedAppServerState {
  return {
    ...state,
    appServerMetadata:
      state.appServerMetadata.kind === "loaded"
        ? { kind: "loaded", data: { ...state.appServerMetadata.data, availableModels: models } }
        : state.appServerMetadata,
    availableModels: models,
  };
}

export function cachedSharedThreadList(state: SharedAppServerState): readonly Thread[] | null {
  return state.threads.kind === "loaded" ? state.threads.data : null;
}

export function cachedSharedAppServerMetadata(state: SharedAppServerState): SharedAppServerMetadata | null {
  if (state.appServerMetadata.kind === "loaded") return state.appServerMetadata.data;
  return null;
}
