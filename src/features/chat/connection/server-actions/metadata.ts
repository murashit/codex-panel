import { type Diagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../../../app-server/diagnostics";
import { listModelMetadata, listSkillCatalog } from "../../../../app-server/resource-operations";
import { runtimeConfigSnapshotFromAppServerConfig } from "../../../../app-server/runtime-config";
import { rateLimitSnapshotFromAppServerSnapshot } from "../../../../app-server/runtime-metrics";
import type { SharedAppServerMetadata } from "../../../../app-server/shared-cache-state";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import { cloneAppServerDiagnostics, type ChatServerActionHost } from "./host";

interface RateLimitMetadataResult {
  data: SharedAppServerMetadata["rateLimit"];
  probe: Diagnostics["probes"]["account/rateLimits/read"];
}

export interface ChatServerMetadataActionsHost extends ChatServerActionHost {
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
}

export interface ChatServerMetadataActions {
  serverMetadataSnapshot: () => SharedAppServerMetadata;
  applyAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  loadAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  refreshPublishedAppServerMetadata: () => Promise<SharedAppServerMetadata | null>;
  publishAppServerMetadataSnapshot: () => void;
  refreshModels: () => Promise<void>;
  loadModels: () => Promise<{ data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] }>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshPublishedSkills: (forceReload?: boolean) => Promise<void>;
  loadSkills: (forceReload?: boolean) => Promise<{ data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] }>;
  refreshRateLimits: () => Promise<void>;
  refreshPublishedRateLimits: () => Promise<void>;
  loadRateLimit: () => Promise<RateLimitMetadataResult>;
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
    publishAppServerMetadataSnapshot: () => {
      publishAppServerMetadataSnapshot(host);
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

function serverMetadataSnapshot(host: ChatServerMetadataActionsHost): SharedAppServerMetadata {
  const state = host.stateStore.getState();
  return {
    runtimeConfig: state.connection.runtimeConfig,
    availableModels: state.connection.availableModels,
    availableSkills: state.connection.availableSkills,
    rateLimit: state.connection.rateLimit,
    appServerDiagnostics: state.connection.appServerDiagnostics,
  };
}

function applyAppServerMetadata(host: ChatServerMetadataActionsHost, metadata: SharedAppServerMetadata): void {
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    runtimeConfig: metadata.runtimeConfig,
    availableModels: metadata.availableModels,
    availableSkills: metadata.availableSkills,
    rateLimit: metadata.rateLimit,
    appServerDiagnostics: metadata.appServerDiagnostics,
  });
}

async function loadAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  return loadAppServerMetadataFromClient(host, client);
}

async function loadAppServerMetadataFromClient(
  host: ChatServerMetadataActionsHost,
  client: NonNullable<ReturnType<ChatServerMetadataActionsHost["currentClient"]>>,
): Promise<SharedAppServerMetadata> {
  const runtimeConfig = runtimeConfigSnapshotFromAppServerConfig(await client.readEffectiveConfig(host.vaultPath));
  const [models, skills, rateLimit] = await Promise.all([
    loadModelsFromClient(client),
    loadSkillsFromClient(client, host.vaultPath),
    loadRateLimitFromClient(client),
  ]);
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  diagnostics.probes["skills/list"] = skills.probe;
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  return {
    runtimeConfig,
    availableModels: models.data,
    availableSkills: skills.data,
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  };
}

async function refreshAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const client = host.currentClient();
  if (!client) return null;
  const metadata = await loadAppServerMetadataFromClient(host, client);
  if (host.currentClient() !== client) return null;
  applyAppServerMetadata(host, metadata);
  return metadata;
}

async function refreshPublishedAppServerMetadata(host: ChatServerMetadataActionsHost): Promise<SharedAppServerMetadata | null> {
  const metadata = await refreshAppServerMetadata(host);
  if (metadata) host.publishAppServerMetadata(metadata);
  return metadata;
}

function publishAppServerMetadataSnapshot(host: ChatServerMetadataActionsHost): void {
  host.publishAppServerMetadata(serverMetadataSnapshot(host));
}

async function refreshModels(host: ChatServerMetadataActionsHost): Promise<boolean> {
  const client = host.currentClient();
  const models = client ? await loadModelsFromClient(client) : disconnectedModelsResult();
  if (client && host.currentClient() !== client) return false;
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["model/list"] = models.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableModels: models.data,
    appServerDiagnostics: diagnostics,
  });
  return true;
}

async function loadModels(
  host: ChatServerMetadataActionsHost,
): Promise<{ data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] }> {
  const client = host.currentClient();
  if (!client) return disconnectedModelsResult();
  return loadModelsFromClient(client);
}

function disconnectedModelsResult(): { data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] } {
  return { data: [], probe: diagnosticProbeError("model/list", new Error("Codex app-server is not connected.")) };
}

async function loadModelsFromClient(
  client: NonNullable<ReturnType<ChatServerMetadataActionsHost["currentClient"]>>,
): Promise<{ data: ModelMetadata[]; probe: Diagnostics["probes"]["model/list"] }> {
  try {
    const data = await listModelMetadata(client);
    return {
      data,
      probe: diagnosticProbeOk("model/list", `${String(data.length)} models`),
    };
  } catch (error) {
    return { data: [], probe: diagnosticProbeError("model/list", error) };
  }
}

async function refreshSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<boolean> {
  const client = host.currentClient();
  const skills = client ? await loadSkillsFromClient(client, host.vaultPath, forceReload) : disconnectedSkillsResult();
  if (client && host.currentClient() !== client) return false;
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["skills/list"] = skills.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    availableSkills: skills.data,
    appServerDiagnostics: diagnostics,
  });
  return true;
}

async function refreshPublishedSkills(host: ChatServerMetadataActionsHost, forceReload = false): Promise<void> {
  if (!(await refreshSkills(host, forceReload))) return;
  publishAppServerMetadataSnapshot(host);
}

async function loadSkills(
  host: ChatServerMetadataActionsHost,
  forceReload = false,
): Promise<{ data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] }> {
  const client = host.currentClient();
  if (!client) return disconnectedSkillsResult();
  return loadSkillsFromClient(client, host.vaultPath, forceReload);
}

function disconnectedSkillsResult(): { data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] } {
  return { data: [], probe: diagnosticProbeError("skills/list", new Error("Codex app-server is not connected.")) };
}

async function loadSkillsFromClient(
  client: NonNullable<ReturnType<ChatServerMetadataActionsHost["currentClient"]>>,
  vaultPath: string,
  forceReload = false,
): Promise<{ data: SkillMetadata[]; probe: Diagnostics["probes"]["skills/list"] }> {
  try {
    const catalog = await listSkillCatalog(client, vaultPath, { forceReload });
    return { data: catalog.skills, probe: diagnosticProbeOk("skills/list", `${String(catalog.totalCount)} skills`) };
  } catch (error) {
    return { data: [], probe: diagnosticProbeError("skills/list", error) };
  }
}

async function refreshRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const client = host.currentClient();
  const rateLimit = client ? await loadRateLimitFromClient(client) : disconnectedRateLimitResult();
  if (client && host.currentClient() !== client) return;
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  host.stateStore.dispatch({
    type: "connection/metadata-applied",
    rateLimit: rateLimit.data,
    appServerDiagnostics: diagnostics,
  });
}

async function refreshPublishedRateLimits(host: ChatServerMetadataActionsHost): Promise<void> {
  const client = host.currentClient();
  const rateLimit = client ? await loadRateLimitFromClient(client) : disconnectedRateLimitResult();
  if (client && host.currentClient() !== client) return;
  const diagnostics = cloneAppServerDiagnostics(host.stateStore.getState().connection.appServerDiagnostics);
  diagnostics.probes["account/rateLimits/read"] = rateLimit.probe;
  if (rateLimit.probe.status === "ok") {
    host.stateStore.dispatch({
      type: "connection/metadata-applied",
      rateLimit: rateLimit.data,
      appServerDiagnostics: diagnostics,
    });
    publishAppServerMetadataSnapshot(host);
    return;
  }
  host.stateStore.dispatch({ type: "connection/metadata-applied", appServerDiagnostics: diagnostics });
}

async function loadRateLimit(host: ChatServerMetadataActionsHost): Promise<RateLimitMetadataResult> {
  const client = host.currentClient();
  if (!client) return disconnectedRateLimitResult();
  return loadRateLimitFromClient(client);
}

function disconnectedRateLimitResult(): RateLimitMetadataResult {
  return {
    data: null,
    probe: diagnosticProbeError("account/rateLimits/read", new Error("Codex app-server is not connected.")),
  };
}

async function loadRateLimitFromClient(
  client: NonNullable<ReturnType<ChatServerMetadataActionsHost["currentClient"]>>,
): Promise<RateLimitMetadataResult> {
  try {
    const response = await client.readAccountRateLimits();
    const rateLimitsByLimitId = response.rateLimitsByLimitId;
    const codexRateLimit = rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, "codex") ? rateLimitsByLimitId["codex"] : undefined;
    const rateLimit = codexRateLimit ?? response.rateLimits;
    return {
      data: rateLimitSnapshotFromAppServerSnapshot(rateLimit),
      probe: diagnosticProbeOk(
        "account/rateLimits/read",
        response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available",
      ),
    };
  } catch (error) {
    return { data: null, probe: diagnosticProbeError("account/rateLimits/read", error) };
  }
}
