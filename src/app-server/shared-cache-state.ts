import type { AppServerDiagnostics } from "./compatibility";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { Model } from "../generated/app-server/v2/Model";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { PanelThread } from "../domain/threads/model";

export interface SharedAppServerMetadata {
  effectiveConfig: ConfigReadResponse | null;
  availableModels: readonly Model[];
  availableSkills: readonly SkillMetadata[];
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: AppServerDiagnostics;
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; data: T };

export interface SharedAppServerState {
  threads: SharedCache<readonly PanelThread[]>;
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

export function applySharedThreadList(state: SharedAppServerState, threads: readonly PanelThread[]): SharedAppServerState {
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
    availableModels: cloneModels(clonedMetadata.availableModels),
  };
}

export function applySharedModels(state: SharedAppServerState, models: readonly Model[]): SharedAppServerState {
  const clonedModels = cloneModels(models);
  return {
    ...state,
    appServerMetadata:
      state.appServerMetadata.kind === "loaded"
        ? { kind: "loaded", data: { ...state.appServerMetadata.data, availableModels: cloneModels(clonedModels) } }
        : state.appServerMetadata,
    availableModels: clonedModels,
  };
}

export function cachedSharedThreadList(state: SharedAppServerState): readonly PanelThread[] | null {
  return state.threads.kind === "loaded" ? cloneThreads(state.threads.data) : null;
}

export function cachedSharedAppServerMetadata(state: SharedAppServerState): SharedAppServerMetadata | null {
  if (state.appServerMetadata.kind === "loaded") return cloneSharedAppServerMetadata(state.appServerMetadata.data);
  return null;
}

export function cachedSharedModels(state: SharedAppServerState): Model[] {
  return cloneModels(state.availableModels);
}

function cloneSharedAppServerMetadata(metadata: SharedAppServerMetadata): SharedAppServerMetadata {
  return {
    ...metadata,
    availableModels: cloneModels(metadata.availableModels),
    availableSkills: metadata.availableSkills.map((skill) => ({ ...skill })),
    appServerDiagnostics: {
      probes: { ...metadata.appServerDiagnostics.probes },
      mcpServers: metadata.appServerDiagnostics.mcpServers.map((server) => ({ ...server })),
    },
  };
}

function cloneThreads(threads: readonly PanelThread[]): PanelThread[] {
  return threads.map((thread) => ({ ...thread }));
}

function cloneModels(models: readonly Model[]): Model[] {
  return models.map((model) => ({
    ...model,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    inputModalities: [...model.inputModalities],
    additionalSpeedTiers: [...model.additionalSpeedTiers],
    serviceTiers: [...model.serviceTiers],
  }));
}
