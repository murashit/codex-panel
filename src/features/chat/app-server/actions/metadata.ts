import {
  readAppServerMetadata,
  readModelMetadataProbe,
  readRateLimitMetadataProbe,
  readSkillMetadataProbe,
  type ModelMetadataProbeResult,
  type RateLimitMetadataProbeResult,
  type SkillMetadataProbeResult,
} from "../../../../app-server/services/metadata";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { cloneServerDiagnostics, type ChatServerActionHost } from "./host";

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  setAppServerMetadata: (metadata: SharedServerMetadata) => void;
}

export interface ChatServerMetadataActions {
  serverMetadataSnapshot: () => SharedServerMetadata;
  applyAppServerMetadata: (metadata: SharedServerMetadata) => void;
  loadAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  refreshPublishedAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  setAppServerMetadataSnapshot: () => void;
  refreshModels: () => Promise<void>;
  loadModels: () => Promise<ModelMetadataProbeResult>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshPublishedSkills: (forceReload?: boolean) => Promise<void>;
  loadSkills: (forceReload?: boolean) => Promise<SkillMetadataProbeResult>;
  refreshRateLimits: () => Promise<void>;
  refreshPublishedRateLimits: () => Promise<void>;
  loadRateLimit: () => Promise<RateLimitMetadataProbeResult>;
}

export function createChatServerMetadataActions(host: ChatServerMetadataActionsHost): ChatServerMetadataActions {
  return {
    serverMetadataSnapshot: () => serverMetadataSnapshot(host),
    applyAppServerMetadata: (metadata) => {
      applyAppServerMetadata(host, metadata);
    },
    loadAppServerMetadata: () => loadAppServerMetadata(host),
    refreshAppServerMetadata: () => refreshAppServerMetadata(host),
    refreshPublishedAppServerMetadata: () => refreshPublishedAppServerMetadata(host),
    setAppServerMetadataSnapshot: () => {
      setAppServerMetadataSnapshot(host);
    },
    refreshModels: async () => {
      await refreshModels(host);
    },
    loadModels: () => loadModels(host),
    refreshSkills: async (forceReload) => {
      await refreshSkills(host, forceReload);
    },
    refreshPublishedSkills: (forceReload) => refreshPublishedSkills(host, forceReload),
    loadSkills: (forceReload) => loadSkills(host, forceReload),
    refreshRateLimits: () => refreshRateLimits(host),
    refreshPublishedRateLimits: () => refreshPublishedRateLimits(host),
    loadRateLimit: () => loadRateLimit(host),
  };
}

function serverMetadataSnapshot(host: ChatServerMetadataActionsHost): SharedServerMetadata {
  const state = host.stateStore.getState();
  return {
    runtimeConfig: state.connection.runtimeConfig,
    availableModels: state.connection.availableModels,
    availableSkills: state.connection.availableSkills,
    rateLimit: state.connection.rateLimit,
    serverDiagnostics: state.connection.serverDiagnostics,
  };
}

function applyAppServerMetadata(host: ChatServerMetadataActionsHost, metadata: SharedServerMetadata): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    runtimeConfig: metadata.runtimeConfig,
    availableModels: metadata.availableModels,
    availableSkills: metadata.availableSkills,
    rateLimit: metadata.rateLimit,
    serverDiagnostics: metadata.serverDiagnostics,
  });
}

async function loadAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  return loadAppServerMetadataFromClient(host, client);
}

async function loadAppServerMetadataFromClient(
  host: ChatServerMetadataActionsHost,
  client: NonNullable<ReturnType<ChatServerMetadataActionsHost["currentClient"]>>,
): Promise<SharedServerMetadata> {
  return readAppServerMetadata(client, host.vaultPath, host.stateStore.getState().connection.serverDiagnostics);
}

async function refreshAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  const metadata = await loadAppServerMetadataFromClient(host, client);
  if (host.currentClient() !== client) return null;
  applyAppServerMetadata(host, metadata);
  return metadata;
}

async function refreshPublishedAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedServerMetadata | null> {
  const metadata = await refreshAppServerMetadata(host);
  if (metadata) host.setAppServerMetadata(metadata);
  return metadata;
}

function setAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  host.setAppServerMetadata(serverMetadataSnapshot(host));
}

async function refreshModels(host: ChatServerMetadataActionsHost): Promise<boolean> {
  const client = host.currentClient();
  const models = await readModelMetadataProbe(client);
  if (client && host.currentClient() !== client) return false;
  const diagnostics = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableModels: models.data,
    serverDiagnostics: diagnostics,
  });
  return true;
}

async function loadModels(host: ChatServerMetadataActionsHost): Promise<ModelMetadataProbeResult> {
  return readModelMetadataProbe(host.currentClient());
}

async function refreshSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<boolean> {
  const client = host.currentClient();
  const skills = await readSkillMetadataProbe(client, host.vaultPath, forceReload);
  if (client && host.currentClient() !== client) return false;
  const diagnostics = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  diagnostics.probes["skills/list"] = skills.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableSkills: skills.data,
    serverDiagnostics: diagnostics,
  });
  return true;
}

async function refreshPublishedSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<void> {
  if (!(await refreshSkills(host, forceReload))) return;
  setAppServerMetadataSnapshot(host);
}

async function loadSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<SkillMetadataProbeResult> {
  return readSkillMetadataProbe(host.currentClient(), host.vaultPath, forceReload);
}

async function refreshRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const client = host.currentClient();
  const rateLimit = await readRateLimitMetadataProbe(client);
  if (client && host.currentClient() !== client) return;
  const diagnostics = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    rateLimit: rateLimit.data,
    serverDiagnostics: diagnostics,
  });
}

async function refreshPublishedRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const client = host.currentClient();
  const rateLimit = await readRateLimitMetadataProbe(client);
  if (client && host.currentClient() !== client) return;
  const diagnostics = cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  if (rateLimit.probe.status === "ok") {
    host.stateStore.dispatch({
      type: "connection/metadata-applied",
      rateLimit: rateLimit.data,
      serverDiagnostics: diagnostics,
    });
    setAppServerMetadataSnapshot(host);
    return;
  }
  host.stateStore.dispatch({ type: "connection/metadata-applied", serverDiagnostics: diagnostics });
}

async function loadRateLimit(host: ChatServerMetadataActionsHost): Promise<RateLimitMetadataProbeResult> {
  return readRateLimitMetadataProbe(host.currentClient());
}
