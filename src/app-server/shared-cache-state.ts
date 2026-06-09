import type { AppServerDiagnostics } from "./compatibility";
import type { ConfigReadResponse } from "../generated/app-server/v2/ConfigReadResponse";
import type { RateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { PanelThread } from "../domain/threads/model";
import type { PanelModelOption, PanelSkillOption } from "../domain/catalog/model";

export interface SharedAppServerMetadata {
  effectiveConfig: ConfigReadResponse | null;
  availableModels: readonly PanelModelOption[];
  availableSkills: readonly PanelSkillOption[];
  rateLimit: RateLimitSnapshot | null;
  appServerDiagnostics: AppServerDiagnostics;
}

type SharedCache<T> = { kind: "unloaded" } | { kind: "loaded"; data: T };

export interface SharedAppServerState {
  threads: SharedCache<readonly PanelThread[]>;
  appServerMetadata: SharedCache<SharedAppServerMetadata>;
  availableModels: readonly PanelModelOption[];
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
    availableModels: cloneModelOptions(clonedMetadata.availableModels),
  };
}

export function applySharedModels(state: SharedAppServerState, models: readonly PanelModelOption[]): SharedAppServerState {
  const clonedModels = cloneModelOptions(models);
  return {
    ...state,
    appServerMetadata:
      state.appServerMetadata.kind === "loaded"
        ? { kind: "loaded", data: { ...state.appServerMetadata.data, availableModels: cloneModelOptions(clonedModels) } }
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

export function cachedSharedModels(state: SharedAppServerState): PanelModelOption[] {
  return cloneModelOptions(state.availableModels);
}

function cloneSharedAppServerMetadata(metadata: SharedAppServerMetadata): SharedAppServerMetadata {
  return {
    ...metadata,
    availableModels: cloneModelOptions(metadata.availableModels),
    availableSkills: cloneSkillOptions(metadata.availableSkills),
    appServerDiagnostics: {
      probes: { ...metadata.appServerDiagnostics.probes },
      mcpServers: metadata.appServerDiagnostics.mcpServers.map((server) => ({ ...server })),
    },
  };
}

function cloneThreads(threads: readonly PanelThread[]): PanelThread[] {
  return threads.map((thread) => ({ ...thread }));
}

function cloneModelOptions(models: readonly PanelModelOption[]): PanelModelOption[] {
  return models.map((model) => ({
    ...model,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    inputModalities: [...model.inputModalities],
    additionalSpeedTiers: [...model.additionalSpeedTiers],
    serviceTiers: model.serviceTiers.map((tier) => ({ ...tier })),
  }));
}

function cloneSkillOptions(skills: readonly PanelSkillOption[]): PanelSkillOption[] {
  return skills.map((skill) => ({ ...skill }));
}
