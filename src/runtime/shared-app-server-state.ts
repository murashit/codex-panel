import type { AppServerDiagnostics } from "../app-server/compatibility";
import { createAppServerDiagnostics } from "../app-server/compatibility";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../generated/app-server/v2/Thread";

export interface SharedSessionMetadata {
  effectiveConfig: ConfigReadResponse | null;
  availableModels: readonly Model[];
  availableSkills: readonly SkillMetadata[];
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: AppServerDiagnostics;
}

export interface SharedAppServerState extends SharedSessionMetadata {
  threads: readonly Thread[] | null;
  sessionMetadataLoaded: boolean;
}

export function createSharedAppServerState(): SharedAppServerState {
  return {
    threads: null,
    sessionMetadataLoaded: false,
    effectiveConfig: null,
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    appServerDiagnostics: createAppServerDiagnostics(),
  };
}

export function applySharedThreadList(state: SharedAppServerState, threads: readonly Thread[]): SharedAppServerState {
  return {
    ...state,
    threads,
  };
}

export function applySharedSessionMetadata(state: SharedAppServerState, metadata: SharedSessionMetadata): SharedAppServerState {
  return {
    ...state,
    ...metadata,
    sessionMetadataLoaded: true,
  };
}

export function applySharedModels(state: SharedAppServerState, models: readonly Model[]): SharedAppServerState {
  return {
    ...state,
    availableModels: models,
  };
}
