import {
  readRateLimitMetadataProbe,
  readRuntimeConfigSnapshot,
  readSkillMetadataProbe,
  type RateLimitMetadataProbeResult,
  type SkillMetadataProbeResult,
} from "../../../../app-server/services/metadata";
import type { ModelMetadata } from "../../../../domain/catalog/metadata";
import { diagnosticsWithProbe, diagnosticProbeError, diagnosticProbeOk } from "../../../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import { cloneServerDiagnostics, type ChatServerActionHost } from "./host";

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  setAppServerMetadata: (metadata: SharedServerMetadata) => void;
  modelsSnapshot: () => readonly ModelMetadata[] | null;
  fetchModels: () => Promise<readonly ModelMetadata[]>;
  refreshModels: () => Promise<readonly ModelMetadata[]>;
}

export interface ChatServerMetadataActions {
  serverMetadataSnapshot: () => SharedServerMetadata;
  applyAppServerMetadata: (metadata: SharedServerMetadata) => void;
  loadAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  refreshAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  refreshPublishedAppServerMetadata: () => Promise<SharedServerMetadata | null>;
  setAppServerMetadataSnapshot: () => void;
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
  const runtimeConfig = await readRuntimeConfigSnapshot(client, host.vaultPath);
  const [models, skills, rateLimit] = await Promise.all([
    loadModelMetadataFromQuery(host),
    readSkillMetadataProbe(client, host.vaultPath),
    readRateLimitMetadataProbe(client),
  ]);
  const diagnostics = [models.probe, skills.probe, rateLimit.probe].reduce(
    (current, probe) => diagnosticsWithProbe(current, probe),
    cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics),
  );
  return {
    runtimeConfig,
    availableModels: models.data,
    availableSkills: skills.data,
    rateLimit: rateLimit.data,
    serverDiagnostics: diagnostics,
  };
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

async function loadModelMetadataFromQuery(host: ChatServerMetadataActionsHost): Promise<{
  data: readonly ModelMetadata[];
  probe: SharedServerMetadata["serverDiagnostics"]["probes"]["model/list"];
}> {
  try {
    const data = await host.fetchModels();
    return { data, probe: diagnosticProbeOk("model/list", `${String(data.length)} models`) };
  } catch (error) {
    return {
      data: host.modelsSnapshot() ?? [],
      probe: diagnosticProbeError("model/list", error),
    };
  }
}

function setAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  host.setAppServerMetadata(serverMetadataSnapshot(host));
}

async function refreshSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<boolean> {
  const client = host.currentClient();
  const skills = await readSkillMetadataProbe(client, host.vaultPath, forceReload);
  if (client && host.currentClient() !== client) return false;
  const diagnostics = diagnosticsWithProbe(cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics), skills.probe);
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
  const diagnostics = diagnosticsWithProbe(
    cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics),
    rateLimit.probe,
  );
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
  const diagnostics = diagnosticsWithProbe(
    cloneServerDiagnostics(host.stateStore.getState().connection.serverDiagnostics),
    rateLimit.probe,
  );
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
